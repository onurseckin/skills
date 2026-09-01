import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  MAX_BLOB_BYTES,
  blobContentDigest,
  blobRelativePath,
  linkBlobIntoView,
  listBlobs,
  putBlobFile,
  type ViewLinker,
} from "../../../../olt/scripts/src/engine/store/layout/blobs.ts";
import {
  cleanupVirtualStoreFS,
  scratchRoot as makeScratchRoot,
  setupVirtualStoreFS,
} from "../../store-fixture.ts";

beforeEach(() => {
  setupVirtualStoreFS();
});

afterEach(() => {
  cleanupVirtualStoreFS();
});

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("blobRelativePath", () => {
  test("shards by the first two hex characters of the digest", () => {
    const digest = "ab".padEnd(64, "0");
    expect(blobRelativePath(digest)).toBe(`blobs/ab/${digest}`);
  });

  test("rejects a digest that is not a lowercase sha256", () => {
    expect(() => blobRelativePath("not-a-digest")).toThrow(HarnessError);
    expect(() => blobRelativePath("A".repeat(64))).toThrow(HarnessError);
  });
});

describe("putBlobFile", () => {
  test("stores new content under its content address and reports created=true", () => {
    const root = scratchRoot("stores-new-content-under-its-content-address-and-r");
    const source = join(root, "source.txt");
    writeFileSync(source, "hello world");
    const result = putBlobFile(root, source);
    expect(result.created).toBe(true);
    expect(result.sha256).toBe(sha256Of("hello world"));
    expect(result.bytes).toBe("hello world".length);
    const stored = readFileSync(join(root, result.path), "utf-8");
    expect(stored).toBe("hello world");
    expect((statSync(join(root, result.path)).mode & 0o222) === 0).toBe(true);
  });

  test("reports created=false and keeps the existing blob when content is already stored", () => {
    const root = scratchRoot("reports-created-false-and-keeps-the-existing-blob-");
    const source = join(root, "source.txt");
    writeFileSync(source, "same content");
    const first = putBlobFile(root, source);
    expect(first.created).toBe(true);
    const second = putBlobFile(root, source);
    expect(second.created).toBe(false);
    expect(second.sha256).toBe(first.sha256);
  });

  test("throws and leaves no staging file behind when the source is not a regular file", () => {
    const root = scratchRoot("throws-and-leaves-no-staging-file-behind-when-the-");
    const directoryAsSource = join(root, "a-directory");
    mkdirSync(directoryAsSource);
    expect(() => putBlobFile(root, directoryAsSource)).toThrow(/not a regular file/);
    const staging = join(root, "blobs");
    expect(readdirSync(staging).filter((name) => name.startsWith(".ingest-"))).toEqual([]);
  });

  test("throws when the source's reported size exceeds the blob byte limit, without reading it", () => {
    const root = scratchRoot("throws-when-the-source-s-reported-size-exceeds-the");
    const source = join(root, "huge.bin");
    writeFileSync(source, "x");
    truncateSync(source, MAX_BLOB_BYTES + 10);
    expect(() => putBlobFile(root, source)).toThrow(
      new RegExp(`capture exceeds the ${MAX_BLOB_BYTES} byte blob limit`),
    );
  });

  test("throws when bytes read exceed the blob byte limit during stream reading", () => {
    const root = scratchRoot("throws-when-bytes-read-exceed-limit-in-loop");
    const source = join(root, "dynamic.bin");
    writeFileSync(source, "initial");

    const readSpy = spyOn(fs, "readSync").mockImplementation(
      (
        _fd: number,
        _buffer: NodeJS.ArrayBufferView,
        _offset: number,
        _length: number,
        _position: fs.ReadPosition | null,
      ) => {
        return MAX_BLOB_BYTES + 1;
      },
    );

    try {
      expect(() => putBlobFile(root, source)).toThrow(
        new RegExp(`capture exceeds the ${MAX_BLOB_BYTES} byte blob limit`),
      );
    } finally {
      readSpy.mockRestore();
      setupVirtualStoreFS();
    }
  });
});

describe("linkBlobIntoView", () => {
  function storeBlob(root: string, content: string) {
    const source = join(root, "source.bin");
    writeFileSync(source, content);
    const put = putBlobFile(root, source);
    return { sha256: put.sha256, bytes: put.bytes, path: put.path };
  }

  test("rejects an unsafe view name", () => {
    const root = scratchRoot("rejects-an-unsafe-view-name");
    const blob = storeBlob(root, "content");
    expect(() => linkBlobIntoView(root, blob, "evidence", "")).toThrow(/unsafe view name/);
    expect(() => linkBlobIntoView(root, blob, "evidence", "a/b")).toThrow(/unsafe view name/);
    expect(() => linkBlobIntoView(root, blob, "evidence", "a\\b")).toThrow(/unsafe view name/);
    expect(() => linkBlobIntoView(root, blob, "evidence", "..")).toThrow(/unsafe view name/);
  });

  test("throws when the referenced blob is not actually stored in the capsule", () => {
    const root = scratchRoot("throws-when-the-referenced-blob-is-not-actually-st");
    const phantom = { sha256: "c".repeat(64), bytes: 1, path: blobRelativePath("c".repeat(64)) };
    expect(() => linkBlobIntoView(root, phantom, "evidence", "name.png")).toThrow(
      /is not stored in this capsule/,
    );
  });

  test("hardlinks by default, producing a file that shares the same inode as the blob", () => {
    const root = scratchRoot("hardlinks-by-default-producing-a-file-that-shares-");
    const blob = storeBlob(root, "shared bytes");
    const view = linkBlobIntoView(root, blob, "evidence", "name.png");
    expect(view.storage).toBe("hardlink");
    const source = join(root, blob.path);
    const target = join(root, view.view_path);
    expect(lstatSync(source).ino).toBe(lstatSync(target).ino);
  });

  test("returns the existing hardlink view unchanged when it already points at the same blob", () => {
    const root = scratchRoot("returns-the-existing-hardlink-view-unchanged-when-");
    const blob = storeBlob(root, "idempotent bytes");
    const first = linkBlobIntoView(root, blob, "evidence", "name.png");
    const second = linkBlobIntoView(root, blob, "evidence", "name.png");
    expect(second).toEqual(first);
  });

  test("replaces a stale view file that points at different content before relinking", () => {
    const root = scratchRoot("replaces-a-stale-view-file-that-points-at-differen");
    const blobA = storeBlob(root, "content-a");
    const blobB = storeBlob(root, "content-b");
    linkBlobIntoView(root, blobA, "evidence", "name.png");
    const relinked = linkBlobIntoView(root, blobB, "evidence", "name.png");
    expect(relinked.sha256).toBe(blobB.sha256);
    const target = join(root, "evidence", "name.png");
    expect(readFileSync(target, "utf-8")).toBe("content-b");
  });

  test("falls back to a read-only copy when the injected linker fails to hardlink", () => {
    const root = scratchRoot("falls-back-to-a-read-only-copy-when-the-injected-l");
    const blob = storeBlob(root, "cross-device bytes");
    const failingLinker: ViewLinker = {
      link: () => {
        throw new Error("EXDEV: cross-device link not permitted");
      },
    };
    const view = linkBlobIntoView(root, blob, "evidence", "name.png", failingLinker);
    expect(view.storage).toBe("copy");
    const target = join(root, view.view_path);
    expect(readFileSync(target, "utf-8")).toBe("cross-device bytes");
    expect((statSync(target).mode & 0o222) === 0).toBe(true);
  });

  test("handles existing target when stat fails during inode check", () => {
    const root = scratchRoot("stat-fails-during-inode-check");
    const blob = storeBlob(root, "stat fail bytes");
    const target = join(root, "evidence", "dangling.png");
    mkdirSync(join(root, "evidence"), { recursive: true });
    symlinkSync(join(root, "evidence", "does-not-exist"), target);
    const view = linkBlobIntoView(root, blob, "evidence", "dangling.png");
    expect(["hardlink", "copy"]).toContain(view.storage);
  });
});
