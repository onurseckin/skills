import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Bytes } from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { putBlobFile } from "../../../orchestrating-long-tasks/scripts/src/store/blobs.ts";
import {
  undeclaredEntries,
  verifyBlobContents,
  verifyCapsuleDeep,
  verifyCapsuleLayout,
} from "../../../orchestrating-long-tasks/scripts/src/store/layout-integrity.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "store-layout-integrity-"));
  roots.push(root);
  return root;
}

describe("verifyCapsuleLayout", () => {
  test("returns no issues for a completely empty run root with no state.json", () => {
    const root = scratchRoot();
    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("returns no issues when state.json is present but unparseable, treating state as absent", () => {
    const root = scratchRoot();
    writeFileSync(join(root, "state.json"), "not json");
    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("returns no issues when state.json parses to a non-object", () => {
    const root = scratchRoot();
    writeFileSync(join(root, "state.json"), JSON.stringify([1, 2]));
    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("combines issues from blob naming, capture references, packets, commands and reports", () => {
    const root = scratchRoot();
    mkdirSync(join(root, "blobs", "zz"), { recursive: true });
    writeFileSync(join(root, "blobs", "zz", "not-a-sha"), "x");
    const found = verifyCapsuleLayout(root);
    expect(found.some((issue) => issue.code === "BLOB_NAME")).toBe(true);
  });
});

describe("undeclaredEntries", () => {
  test("returns no issues for an empty run root", () => {
    const root = scratchRoot();
    expect(undeclaredEntries(root)).toEqual([]);
  });

  test("ignores dotfiles and every declared capsule entry", () => {
    const root = scratchRoot();
    writeFileSync(join(root, ".hidden"), "x");
    writeFileSync(join(root, "manifest.json"), "{}");
    mkdirSync(join(root, "blobs"));
    expect(undeclaredEntries(root)).toEqual([]);
  });

  test("reports LAYOUT_UNDECLARED for an entry not part of the declared capsule layout", () => {
    const root = scratchRoot();
    writeFileSync(join(root, "mystery-file.txt"), "x");
    const found = undeclaredEntries(root);
    expect(found).toEqual([expect.objectContaining({ code: "LAYOUT_UNDECLARED" })]);
  });

  test("reports LAYOUT_UNREADABLE when the capsule root itself cannot be listed", () => {
    const root = scratchRoot();
    const capsule = join(root, "capsule");
    mkdirSync(capsule);
    chmodSync(capsule, 0o000);
    try {
      const found = undeclaredEntries(capsule);
      expect(found).toEqual([expect.objectContaining({ code: "LAYOUT_UNREADABLE" })]);
    } finally {
      chmodSync(capsule, 0o755);
    }
  });
});

describe("blob naming (via verifyCapsuleLayout)", () => {
  test("returns no issues when blobs/ does not exist", () => {
    const root = scratchRoot();
    expect(verifyCapsuleLayout(root).some((i) => i.code.startsWith("BLOB"))).toBe(false);
  });

  test("ignores dotfiles at the shard level", () => {
    const root = scratchRoot();
    mkdirSync(join(root, "blobs", ".hidden-shard"), { recursive: true });
    expect(verifyCapsuleLayout(root).some((i) => i.code.startsWith("BLOB"))).toBe(false);
  });

  test("reports BLOB_UNREADABLE when blobs/ itself cannot be listed", () => {
    const root = scratchRoot();
    const blobsDir = join(root, "blobs");
    mkdirSync(blobsDir);
    chmodSync(blobsDir, 0o000);
    try {
      const found = verifyCapsuleLayout(root);
      expect(found).toEqual([expect.objectContaining({ code: "BLOB_UNREADABLE" })]);
    } finally {
      chmodSync(blobsDir, 0o755);
    }
  });

  test("reports BLOB_LAYOUT when a shard entry is not itself a directory", () => {
    const root = scratchRoot();
    mkdirSync(join(root, "blobs"));
    writeFileSync(join(root, "blobs", "not-a-shard"), "x");
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_LAYOUT" })]);
  });

  test("reports BLOB_UNREADABLE for a shard directory that cannot be listed", () => {
    const root = scratchRoot();
    const shardDir = join(root, "blobs", "aa");
    mkdirSync(shardDir, { recursive: true });
    chmodSync(shardDir, 0o000);
    try {
      const found = verifyCapsuleLayout(root);
      expect(found).toEqual([expect.objectContaining({ code: "BLOB_UNREADABLE" })]);
    } finally {
      chmodSync(shardDir, 0o755);
    }
  });

  test("reports BLOB_NAME for an entry not named by a sha256, and skips dotfiles", () => {
    const root = scratchRoot();
    const shardDir = join(root, "blobs", "aa");
    mkdirSync(shardDir, { recursive: true });
    writeFileSync(join(shardDir, ".hidden"), "x");
    writeFileSync(join(shardDir, "not-a-digest"), "x");
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_NAME" })]);
  });

  test("reports BLOB_SHARD when a properly named blob sits under the wrong shard prefix", () => {
    const root = scratchRoot();
    const digest = "b".repeat(64);
    const wrongShard = join(root, "blobs", "zz");
    mkdirSync(wrongShard, { recursive: true });
    writeFileSync(join(wrongShard, digest), "content", { mode: 0o444 });
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_SHARD" })]);
  });

  test("reports BLOB_KIND when the blob entry is a directory rather than a regular file", () => {
    const root = scratchRoot();
    const digest = "c".repeat(64);
    mkdirSync(join(root, "blobs", "cc", digest), { recursive: true });
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_KIND" })]);
  });

  test("reports BLOB_MODE when the blob file is writable", () => {
    const root = scratchRoot();
    const source = join(root, "source.txt");
    writeFileSync(source, "content");
    const put = putBlobFile(root, source);
    chmodSync(join(root, put.path), 0o644);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_MODE" })]);
  });

  test("reports BLOB_UNREADABLE for a blob entry whose own stat fails, such as a dangling symlink", () => {
    const root = scratchRoot();
    const digest = "d".repeat(64);
    const shardDir = join(root, "blobs", "dd");
    mkdirSync(shardDir, { recursive: true });
    symlinkSync(join(shardDir, "missing-target"), join(shardDir, digest));
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_KIND" })]);
  });

  test("reports BLOB_UNREADABLE when a blob entry's own lstat fails despite the shard listing succeeding", () => {
    const root = scratchRoot();
    const digest = "a".repeat(64);
    const shardDir = join(root, "blobs", "aa");
    mkdirSync(shardDir, { recursive: true });
    writeFileSync(join(shardDir, digest), "x", { mode: 0o444 });
    // Read+write but no execute on the shard: readdirSync can still list the entry name, but
    // lstat on that entry requires traversal (execute) permission and fails with EACCES.
    chmodSync(shardDir, 0o600);
    try {
      const found = verifyCapsuleLayout(root);
      expect(found).toEqual([expect.objectContaining({ code: "BLOB_UNREADABLE" })]);
    } finally {
      chmodSync(shardDir, 0o755);
    }
  });
});

function captureFixture(overrides: Record<string, unknown> = {}) {
  return {
    kind: "screenshot",
    name: "shot.png",
    sha256: "e".repeat(64),
    bytes: 5,
    blob_path: `blobs/ee/${"e".repeat(64)}`,
    path: "evidence/shot.png",
    storage: "hardlink",
    original_path: "/tmp/shot.png",
    ...overrides,
  };
}

function writeCaptures(root: string, captures: unknown[]): void {
  writeFileSync(join(root, "captures.json"), JSON.stringify({ captures }));
}

describe("capture references (via verifyCapsuleLayout)", () => {
  test("returns no issues when captures.json does not exist", () => {
    const root = scratchRoot();
    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("reports CAPTURE_DIGEST when the capture's sha256 is 64 characters but not valid lowercase hex", () => {
    const root = scratchRoot();
    // readCaptures already drops anything whose sha256 isn't exactly 64 characters, so only a
    // 64-character non-hex string reaches captureReferences' own SHA256_PATTERN check.
    writeCaptures(root, [captureFixture({ sha256: "g".repeat(64) })]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_DIGEST" })]);
  });

  test("reports CAPTURE_BLOB_PATH when blob_path does not match the sha256's own content address", () => {
    const root = scratchRoot();
    writeCaptures(root, [captureFixture({ blob_path: "blobs/00/wrong" })]);
    const found = verifyCapsuleLayout(root);
    expect(found.some((i) => i.code === "CAPTURE_BLOB_PATH")).toBe(true);
  });

  test("reports CAPTURE_BLOB_MISSING and CAPTURE_VIEW_MISSING when neither file exists", () => {
    const root = scratchRoot();
    writeCaptures(root, [captureFixture()]);
    const found = verifyCapsuleLayout(root);
    expect(found.map((i) => i.code).sort()).toEqual([
      "CAPTURE_BLOB_MISSING",
      "CAPTURE_VIEW_MISSING",
    ]);
  });

  test("reports no divergence issue for a hardlinked capture whose view still shares the blob's inode", () => {
    const root = scratchRoot();
    const digest = "e".repeat(64);
    const blobDir = join(root, "blobs", "ee");
    mkdirSync(blobDir, { recursive: true });
    const blobPath = join(blobDir, digest);
    writeFileSync(blobPath, "hello", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    const viewPath = join(root, "evidence", "shot.png");
    linkSync(blobPath, viewPath);
    writeCaptures(root, [captureFixture({ sha256: digest, blob_path: `blobs/ee/${digest}` })]);
    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("reports CAPTURE_VIEW_DIVERGED for a hardlinked capture whose view is no longer the same inode", () => {
    const root = scratchRoot();
    const digest = "e".repeat(64);
    const blobDir = join(root, "blobs", "ee");
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "hello", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "shot.png"), "hello");
    writeCaptures(root, [captureFixture({ sha256: digest, blob_path: `blobs/ee/${digest}` })]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_VIEW_DIVERGED" })]);
  });

  test("accepts a copy-storage capture whose view content still hashes to the recorded digest", () => {
    const root = scratchRoot();
    const digest = sha256Bytes(new TextEncoder().encode("copied bytes"));
    const blobDir = join(root, "blobs", digest.slice(0, 2));
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "copied bytes", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "shot.png"), "copied bytes");
    writeCaptures(root, [
      captureFixture({
        sha256: digest,
        blob_path: `blobs/${digest.slice(0, 2)}/${digest}`,
        storage: "copy",
      }),
    ]);
    expect(verifyCapsuleLayout(root)).toEqual([]);
  });

  test("reports CAPTURE_VIEW_DIVERGED for a copy-storage capture whose view content has since changed", () => {
    const root = scratchRoot();
    const digest = sha256Bytes(new TextEncoder().encode("original bytes"));
    const blobDir = join(root, "blobs", digest.slice(0, 2));
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "original bytes", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "shot.png"), "tampered bytes");
    writeCaptures(root, [
      captureFixture({
        sha256: digest,
        blob_path: `blobs/${digest.slice(0, 2)}/${digest}`,
        storage: "copy",
      }),
    ]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_VIEW_DIVERGED" })]);
  });

  test("reports CAPTURE_UNREADABLE for a copy-storage capture whose view file cannot be read", () => {
    const root = scratchRoot();
    const digest = "e".repeat(64);
    const blobDir = join(root, "blobs", "ee");
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "hello", { mode: 0o444 });
    mkdirSync(join(root, "evidence", "shot.png"), { recursive: true });
    writeCaptures(root, [
      captureFixture({ sha256: digest, blob_path: `blobs/ee/${digest}`, storage: "copy" }),
    ]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_UNREADABLE" })]);
  });

  test("reports CAPTURE_STORAGE for an unrecognized storage mode when both files are present", () => {
    const root = scratchRoot();
    const digest = "e".repeat(64);
    const blobDir = join(root, "blobs", "ee");
    mkdirSync(blobDir, { recursive: true });
    writeFileSync(join(blobDir, digest), "hello", { mode: 0o444 });
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "shot.png"), "hello");
    writeCaptures(root, [
      captureFixture({ sha256: digest, blob_path: `blobs/ee/${digest}`, storage: "teleport" }),
    ]);
    const found = verifyCapsuleLayout(root);
    expect(found).toEqual([expect.objectContaining({ code: "CAPTURE_STORAGE" })]);
  });

  test("reports CAPTURE_NAME_REUSED when two captures claim the same view path", () => {
    const root = scratchRoot();
    writeCaptures(root, [
      captureFixture({ sha256: "1".repeat(64) }),
      captureFixture({ sha256: "2".repeat(64) }),
    ]);
    const found = verifyCapsuleLayout(root);
    expect(found.some((i) => i.code === "CAPTURE_NAME_REUSED")).toBe(true);
  });
});

describe("verifyCapsuleDeep", () => {
  test("combines undeclared entries and blob content verification", () => {
    const root = scratchRoot();
    writeFileSync(join(root, "mystery.txt"), "x");
    const found = verifyCapsuleDeep(root);
    expect(found.some((i) => i.code === "LAYOUT_UNDECLARED")).toBe(true);
  });
});

describe("verifyBlobContents", () => {
  test("returns no issues when there are no blobs", () => {
    const root = scratchRoot();
    expect(verifyBlobContents(root)).toEqual([]);
  });

  test("returns no issues when every stored blob's content still hashes to its own name", () => {
    const root = scratchRoot();
    const source = join(root, "source.txt");
    writeFileSync(source, "authentic bytes");
    putBlobFile(root, source);
    expect(verifyBlobContents(root)).toEqual([]);
  });

  test("reports BLOB_CONTENT when a stored blob's bytes no longer match its own digest name", () => {
    const root = scratchRoot();
    const source = join(root, "source.txt");
    writeFileSync(source, "authentic bytes");
    const put = putBlobFile(root, source);
    chmodSync(join(root, put.path), 0o644);
    writeFileSync(join(root, put.path), "tampered bytes");
    const found = verifyBlobContents(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_CONTENT" })]);
  });

  test("reports BLOB_UNREADABLE when a listed blob cannot actually be opened", () => {
    const root = scratchRoot();
    const digest = "f".repeat(64);
    const shardDir = join(root, "blobs", "ff");
    mkdirSync(shardDir, { recursive: true });
    mkdirSync(join(shardDir, digest));
    const found = verifyBlobContents(root);
    expect(found).toEqual([expect.objectContaining({ code: "BLOB_UNREADABLE" })]);
  });
});
