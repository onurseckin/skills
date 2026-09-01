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
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  MAX_BLOB_BYTES,
  blobContentDigest,
  blobRelativePath,
  linkBlobIntoView,
  listBlobs,
  putBlobFile,
  type ViewLinker,
} from "../../../olt/scripts/src/engine/store/layout/blobs.ts";
import { cleanupVirtualStoreFS, scratchRoot as makeScratchRoot, setupVirtualStoreFS } from "../store-fixture.ts";

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

describe("listBlobs", () => {
  test("returns an empty list when the blobs/ directory does not exist", () => {
    const root = scratchRoot("returns-an-empty-list-when-the-blobs-directory-doe");
    expect(listBlobs(root)).toEqual([]);
  });

  test("lists stored blobs sorted by digest, skipping dotfiles and malformed entries", () => {
    const root = scratchRoot("lists-stored-blobs-sorted-by-digest-skipping-dotfi");
    const source = join(root, "source.txt");
    writeFileSync(source, "list me");
    const put = putBlobFile(root, source);
    const shardDir = join(root, "blobs", put.sha256.slice(0, 2));
    writeFileSync(join(shardDir, ".hidden"), "ignored");
    writeFileSync(join(shardDir, "not-a-sha"), "ignored");
    writeFileSync(join(shardDir, "f".repeat(64)), "wrong shard, ignored");
    const listed = listBlobs(root);
    expect(listed).toEqual([{ sha256: put.sha256, bytes: 7, path: put.path }]);
  });

  test("skips a shard entry that is not a directory and a dotfile shard", () => {
    const root = scratchRoot("skips-a-shard-entry-that-is-not-a-directory-and-a-");
    mkdirSync(join(root, "blobs"));
    writeFileSync(join(root, "blobs", "not-a-shard-dir"), "ignored");
    mkdirSync(join(root, "blobs", ".hidden-shard"));
    expect(listBlobs(root)).toEqual([]);
  });

  test("sorts multiple stored blobs by their digest", () => {
    const root = scratchRoot("sorts-multiple-stored-blobs-by-their-digest");
    const first = putBlobFile(
      root,
      (() => {
        const p = join(root, "first.txt");
        writeFileSync(p, "first content");
        return p;
      })(),
    );
    const second = putBlobFile(
      root,
      (() => {
        const p = join(root, "second.txt");
        writeFileSync(p, "second content");
        return p;
      })(),
    );
    const listed = listBlobs(root);
    expect(listed.map((entry) => entry.sha256)).toEqual(
      [first.sha256, second.sha256].sort((a, b) => (a < b ? -1 : 1)),
    );
  });

  test("skips a shard directory that cannot be listed", () => {
    const root = scratchRoot("skips-a-shard-directory-that-cannot-be-listed");
    const shardDir = join(root, "blobs", "aa");
    mkdirSync(shardDir, { recursive: true });
    chmodSync(shardDir, 0o000);
    try {
      expect(listBlobs(root)).toEqual([]);
    } finally {
      chmodSync(shardDir, 0o755);
    }
  });

  test("skips a blob entry whose stat fails, such as a dangling symlink", () => {
    const root = scratchRoot("skips-a-blob-entry-whose-stat-fails-such-as-a-dang");
    const source = join(root, "source.txt");
    writeFileSync(source, "content");
    const put = putBlobFile(root, source);
    const shardDir = join(root, "blobs", put.sha256.slice(0, 2));
    const brokenName = `${put.sha256.slice(0, 2)}${"0".repeat(62)}`;
    symlinkSync(join(shardDir, "missing-target"), join(shardDir, brokenName));
    const listed = listBlobs(root);
    expect(listed.map((entry) => entry.sha256)).toEqual([put.sha256]);
  });
});


describe("blobContentDigest", () => {
  test("returns the sha256 digest of a stored blob's actual bytes", () => {
    const root = scratchRoot("returns-the-sha256-digest-of-a-stored-blob-s-actua");
    const source = join(root, "source.txt");
    writeFileSync(source, "digest me");
    const put = putBlobFile(root, source);
    expect(blobContentDigest(root, put.sha256)).toBe(put.sha256);
  });

  test("returns undefined when the blob file does not exist", () => {
    const root = scratchRoot("returns-undefined-when-the-blob-file-does-not-exis");
    expect(blobContentDigest(root, "d".repeat(64))).toBeUndefined();
  });

  test("returns undefined when the blob path is not a regular file", () => {
    const root = scratchRoot("returns-undefined-when-the-blob-path-is-not-a-regu");
    const digest = "e".repeat(64);
    const shardDir = join(root, "blobs", digest.slice(0, 2));
    mkdirSync(join(shardDir, digest), { recursive: true });
    expect(blobContentDigest(root, digest)).toBeUndefined();
  });
});

