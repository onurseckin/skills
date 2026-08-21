import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  blobRelativePath,
  linkBlobIntoView,
  listBlobs,
  putBlobFile,
} from "../../orchestrating-long-tasks/scripts/src/store/blobs.ts";
import {
  undeclaredEntries,
  verifyBlobContents,
  verifyCapsuleLayout,
} from "../../orchestrating-long-tasks/scripts/src/store/layout-integrity.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    // Blobs are read-only, so the tree has to be made writable before it can be removed.
    try {
      chmodSync(root, 0o755);
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

function runRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "blob-store-"));
  roots.push(root);
  return root;
}

function source(root: string, name: string, body: string): string {
  const directory = join(root, "source");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, body, "utf-8");
  return path;
}

function digestOf(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

describe("the blob store is the one physical home for a captured byte", () => {
  test("a blob is named by its content and stored read-only under a two-character shard", () => {
    const root = runRoot();
    const stored = putBlobFile(root, source(root, "shot.png", "pixels"));

    expect(stored.sha256).toBe(digestOf("pixels"));
    expect(stored.bytes).toBe(6);
    expect(stored.created).toBeTrue();
    expect(stored.path).toBe(`blobs/${stored.sha256.slice(0, 2)}/${stored.sha256}`);
    expect(readFileSync(join(root, stored.path), "utf-8")).toBe("pixels");
    expect(statSync(join(root, stored.path)).mode & 0o222).toBe(0);
  });

  test("storing the same bytes a second time writes nothing and reports it created nothing", () => {
    const root = runRoot();
    const first = putBlobFile(root, source(root, "a.png", "same"));
    const second = putBlobFile(root, source(root, "b.png", "same"));

    expect(second.sha256).toBe(first.sha256);
    expect(first.created).toBeTrue();
    expect(second.created).toBeFalse();
    expect(listBlobs(root)).toHaveLength(1);
  });

  test("a readable name is a second name for one set of bytes, not a second copy", () => {
    const root = runRoot();
    const stored = putBlobFile(root, source(root, "chart.png", "pixels"));

    const link = linkBlobIntoView(root, stored, "evidence/screenshots", "chart.png");

    expect(link.storage).toBe("hardlink");
    expect(link.view_path).toBe("evidence/screenshots/chart.png");
    const blob = statSync(join(root, stored.path));
    const view = statSync(join(root, link.view_path));
    expect(view.ino).toBe(blob.ino);
    expect(view.dev).toBe(blob.dev);
    expect(view.nlink).toBeGreaterThanOrEqual(2);
  });

  test("linking the same blob to the same name again is a no-op, not a relink", () => {
    const root = runRoot();
    const stored = putBlobFile(root, source(root, "chart.png", "pixels"));
    const first = linkBlobIntoView(root, stored, "evidence/screenshots", "chart.png");
    const second = linkBlobIntoView(root, stored, "evidence/screenshots", "chart.png");

    expect(second).toEqual(first);
    expect(listBlobs(root)).toHaveLength(1);
  });

  test("a filesystem that refuses a hardlink still keeps the evidence, and declares the copy", () => {
    const root = runRoot();
    const stored = putBlobFile(root, source(root, "chart.png", "pixels"));

    const link = linkBlobIntoView(root, stored, "evidence/screenshots", "chart.png", {
      link() {
        throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
      },
    });

    expect(link.storage).toBe("copy");
    expect(readFileSync(join(root, link.view_path), "utf-8")).toBe("pixels");
    // The duplication is real, which is exactly why the record has to say so.
    expect(statSync(join(root, link.view_path)).ino).not.toBe(
      statSync(join(root, stored.path)).ino,
    );
    expect(statSync(join(root, link.view_path)).mode & 0o222).toBe(0);
  });

  test("a foreign file already sitting on the readable name is replaced by the link", () => {
    const root = runRoot();
    const stored = putBlobFile(root, source(root, "chart.png", "pixels"));
    mkdirSync(join(root, "evidence", "screenshots"), { recursive: true });
    writeFileSync(join(root, "evidence", "screenshots", "chart.png"), "something-else", "utf-8");

    const link = linkBlobIntoView(root, stored, "evidence/screenshots", "chart.png");

    expect(link.storage).toBe("hardlink");
    expect(readFileSync(join(root, link.view_path), "utf-8")).toBe("pixels");
    expect(statSync(join(root, link.view_path)).ino).toBe(statSync(join(root, stored.path)).ino);
  });

  test("a name that could escape the view directory is refused", () => {
    const root = runRoot();
    const stored = putBlobFile(root, source(root, "chart.png", "pixels"));

    expect(() => linkBlobIntoView(root, stored, "evidence", "../escape.png")).toThrow(
      /unsafe view name/u,
    );
    expect(() => linkBlobIntoView(root, stored, "evidence", "")).toThrow(/unsafe view name/u);
  });

  test("linking bytes this capsule never stored is refused rather than invented", () => {
    const root = runRoot();
    const absent = digestOf("never-stored");

    expect(() =>
      linkBlobIntoView(
        root,
        { sha256: absent, bytes: 1, path: blobRelativePath(absent) },
        "evidence",
        "ghost.png",
      ),
    ).toThrow(/not stored in this capsule/u);
  });

  test("a digest that is not a lowercase SHA-256 has no address", () => {
    expect(() => blobRelativePath("NOTADIGEST")).toThrow(/lowercase SHA-256/u);
  });

  test("a source that is not a regular file is refused", () => {
    const root = runRoot();
    mkdirSync(join(root, "source", "adirectory"), { recursive: true });

    expect(() => putBlobFile(root, join(root, "source", "adirectory"))).toThrow(
      /not a regular file/u,
    );
  });

  test("a capture larger than the blob limit is refused rather than pulled through the harness", () => {
    const root = runRoot();
    mkdirSync(join(root, "source"), { recursive: true });
    const huge = join(root, "source", "huge.png");
    // Sparse: the size the guard reads is real, the bytes on disk are not.
    const handle = openSync(huge, "w");
    ftruncateSync(handle, 300 * 1024 * 1024);
    closeSync(handle);

    expect(() => putBlobFile(root, huge)).toThrow(/blob limit/u);
    expect(listBlobs(root)).toEqual([]);
  });

  test("a blob directory that cannot be read is reported, not treated as empty", () => {
    const root = runRoot();
    putBlobFile(root, source(root, "shot.png", "pixels"));
    const shard = readdirSync(join(root, "blobs"))[0]!;
    chmodSync(join(root, "blobs", shard), 0o000);

    const codes = verifyCapsuleLayout(root).map((issue) => issue.code);
    chmodSync(join(root, "blobs", shard), 0o755);

    expect(codes).toContain("BLOB_UNREADABLE");
  });

  test("a capsule root that cannot be read is reported rather than declared clean", () => {
    expect(undeclaredEntries(join(tmpdir(), "no-such-capsule-root")).map((i) => i.code)).toEqual([
      "LAYOUT_UNREADABLE",
    ]);
  });

  test("the deep pass catches a blob whose bytes stopped matching its name", () => {
    const root = runRoot();
    const stored = putBlobFile(root, source(root, "shot.png", "pixels"));
    expect(verifyBlobContents(root)).toEqual([]);

    const path = join(root, stored.path);
    chmodSync(path, 0o644);
    writeFileSync(path, "tampered", "utf-8");

    expect(verifyBlobContents(root).map((issue) => issue.code)).toEqual(["BLOB_CONTENT"]);
  });

  test("an entry the layout does not declare is reported rather than tolerated", () => {
    const root = runRoot();
    writeFileSync(join(root, "scratch.txt"), "stray", "utf-8");

    const codes = undeclaredEntries(root).map((issue) => issue.code);

    expect(codes).toContain("LAYOUT_UNDECLARED");
    // The source directory this fixture writes into is undeclared too, and both are reported.
    expect(undeclaredEntries(root).map((issue) => issue.message)).toContain(
      "capsule holds an undeclared entry: scratch.txt",
    );
  });
});
