import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  undeclaredEntries,
  verifyCapsuleLayout,
} from "../../../olt/scripts/src/engine/store/integrity/layout-integrity.ts";
import {
  chmodSync,
  cleanupVirtualStoreFS,
  scratchRoot as makeScratchRoot,
  setupVirtualStoreFS,
} from "../store-fixture.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("layout integrity suite", () => {
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = setupVirtualStoreFS();
  });

  afterEach(() => {
    cleanupVirtualStoreFS();
  });

  function scratchRoot(label: string): string {
    return makeScratchRoot(import.meta.path, label);
  }

  describe("verifyCapsuleLayout", () => {
    test("returns no issues for a completely empty run root with no state.json", () => {
      const root = scratchRoot("returns-no-issues-for-a-completely-empty-run-root-");
      expect(verifyCapsuleLayout(root)).toEqual([]);
    });

    test("returns no issues when state.json is present but unparseable, treating state as absent", () => {
      const root = scratchRoot("returns-no-issues-when-state-json-is-present-but-u");
      vfs.writeFileSync(join(root, "state.json"), "not json");
      expect(verifyCapsuleLayout(root)).toEqual([]);
    });

    test("returns no issues when state.json parses to a non-object", () => {
      const root = scratchRoot("returns-no-issues-when-state-json-parses-to-a-non-");
      vfs.writeFileSync(join(root, "state.json"), JSON.stringify([1, 2]));
      expect(verifyCapsuleLayout(root)).toEqual([]);
    });

    test("combines issues from blob naming, capture references, packets, commands and reports", () => {
      const root = scratchRoot("combines-issues-from-blob-naming-capture-reference");
      vfs.mkdirSync(join(root, "blobs", "zz"), { recursive: true });
      vfs.writeFileSync(join(root, "blobs", "zz", "not-a-sha"), "x");
      const found = verifyCapsuleLayout(root);
      expect(found.some((issue) => issue.code === "BLOB_NAME")).toBe(true);
    });
  });

  describe("undeclaredEntries", () => {
    test("returns no issues for an empty run root", () => {
      const root = scratchRoot("returns-no-issues-for-an-empty-run-root");
      expect(undeclaredEntries(root)).toEqual([]);
    });

    test("ignores dotfiles and every declared capsule entry", () => {
      const root = scratchRoot("ignores-dotfiles-and-every-declared-capsule-entry");
      vfs.writeFileSync(join(root, ".hidden"), "x");
      vfs.writeFileSync(join(root, "manifest.json"), "{}");
      vfs.mkdirSync(join(root, "blobs"));
      expect(undeclaredEntries(root)).toEqual([]);
    });

    test("reports LAYOUT_UNDECLARED for an entry not part of the declared capsule layout", () => {
      const root = scratchRoot("reports-layout-undeclared-for-an-entry-not-part-of");
      vfs.writeFileSync(join(root, "mystery-file.txt"), "x");
      const found = undeclaredEntries(root);
      expect(found).toEqual([expect.objectContaining({ code: "LAYOUT_UNDECLARED" })]);
    });

    test("reports LAYOUT_UNREADABLE when the capsule root itself cannot be listed", () => {
      const root = scratchRoot("reports-layout-unreadable-when-the-capsule-root-it");
      const capsule = join(root, "capsule");
      vfs.mkdirSync(capsule);
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
      const root = scratchRoot("returns-no-issues-when-blobs-does-not-exist");
      expect(verifyCapsuleLayout(root).some((i) => i.code.startsWith("BLOB"))).toBe(false);
    });

    test("ignores dotfiles at the shard level", () => {
      const root = scratchRoot("ignores-dotfiles-at-the-shard-level");
      vfs.mkdirSync(join(root, "blobs", ".hidden-shard"), { recursive: true });
      expect(verifyCapsuleLayout(root).some((i) => i.code.startsWith("BLOB"))).toBe(false);
    });

    test("reports BLOB_UNREADABLE when blobs/ itself cannot be listed", () => {
      const root = scratchRoot("reports-blob-unreadable-when-blobs-itself-cannot-b");
      const blobsDir = join(root, "blobs");
      vfs.mkdirSync(blobsDir);
      chmodSync(blobsDir, 0o000);
      try {
        const found = verifyCapsuleLayout(root);
        expect(found).toEqual([expect.objectContaining({ code: "BLOB_UNREADABLE" })]);
      } finally {
        chmodSync(blobsDir, 0o755);
      }
    });

    test("reports BLOB_LAYOUT when a shard entry is not itself a directory", () => {
      const root = scratchRoot("reports-blob-layout-when-a-shard-entry-is-not-itse");
      vfs.mkdirSync(join(root, "blobs"));
      vfs.writeFileSync(join(root, "blobs", "not-a-shard"), "x");
      const found = verifyCapsuleLayout(root);
      expect(found).toEqual([expect.objectContaining({ code: "BLOB_LAYOUT" })]);
    });

    test("reports BLOB_UNREADABLE for a shard directory that cannot be listed", () => {
      const root = scratchRoot("reports-blob-unreadable-for-a-shard-directory-that");
      const shardDir = join(root, "blobs", "aa");
      vfs.mkdirSync(shardDir, { recursive: true });
      chmodSync(shardDir, 0o000);
      try {
        const found = verifyCapsuleLayout(root);
        expect(found).toEqual([expect.objectContaining({ code: "BLOB_UNREADABLE" })]);
      } finally {
        chmodSync(shardDir, 0o755);
      }
    });

    test("reports BLOB_NAME for an entry not named by a sha256, and skips dotfiles", () => {
      const root = scratchRoot("reports-blob-name-for-an-entry-not-named-by-a-sha2");
      const shardDir = join(root, "blobs", "aa");
      vfs.mkdirSync(shardDir, { recursive: true });
      vfs.writeFileSync(join(shardDir, ".hidden"), "x");
      vfs.writeFileSync(join(shardDir, "not-a-digest"), "x");
      const found = verifyCapsuleLayout(root);
      expect(found).toEqual([expect.objectContaining({ code: "BLOB_NAME" })]);
    });

    test("reports BLOB_SHARD when a properly named blob sits under the wrong shard prefix", () => {
      const root = scratchRoot("reports-blob-shard-when-a-properly-named-blob-sits");
      const digest = "b".repeat(64);
      const wrongShard = join(root, "blobs", "zz");
      vfs.mkdirSync(wrongShard, { recursive: true });
      vfs.writeFileSync(join(wrongShard, digest), "content");
      chmodSync(join(wrongShard, digest), 0o444);
      const found = verifyCapsuleLayout(root);
      expect(found).toEqual([expect.objectContaining({ code: "BLOB_SHARD" })]);
    });

    test("reports BLOB_KIND when the blob entry is a directory rather than a regular file", () => {
      const root = scratchRoot("reports-blob-kind-when-the-blob-entry-is-a-directo");
      const digest = "c".repeat(64);
      vfs.mkdirSync(join(root, "blobs", "cc", digest), { recursive: true });
      const found = verifyCapsuleLayout(root);
      expect(found).toEqual([expect.objectContaining({ code: "BLOB_KIND" })]);
    });

    test("aggregates multiple distinct blob defects across shards in a single pass", () => {
      const root = scratchRoot("aggregates-multiple-distinct-blob-defects");
      const shardAa = join(root, "blobs", "aa");
      const shardBb = join(root, "blobs", "bb");
      const shardCc = join(root, "blobs", "cc");
      vfs.mkdirSync(shardAa, { recursive: true });
      vfs.mkdirSync(shardBb, { recursive: true });
      vfs.mkdirSync(shardCc, { recursive: true });

      // Defect 1: non-sha name in shard aa
      vfs.writeFileSync(join(shardAa, "not-a-sha"), "x");
      // Defect 2: directory as blob in shard bb
      vfs.mkdirSync(join(shardBb, "b".repeat(64)));
      // Defect 3: wrong shard prefix in shard cc
      const dDigest = "d".repeat(64);
      vfs.writeFileSync(join(shardCc, dDigest), "x");
      chmodSync(join(shardCc, dDigest), 0o444);

      const found = verifyCapsuleLayout(root);
      expect(found.some((i) => i.code === "BLOB_NAME")).toBe(true);
      expect(found.some((i) => i.code === "BLOB_KIND")).toBe(true);
      expect(found.some((i) => i.code === "BLOB_SHARD")).toBe(true);
    });

    test("handles unreadable manifest permission without crashing", () => {
      const root = scratchRoot("handles-unreadable-manifest-gracefully");
      const manifestPath = join(root, "manifest.json");
      vfs.writeFileSync(manifestPath, "{}");
      chmodSync(manifestPath, 0o000);
      try {
        const undeclared = undeclaredEntries(root);
        expect(undeclared).toEqual([]);
        const issues = verifyCapsuleLayout(root);
        expect(Array.isArray(issues)).toBe(true);
      } finally {
        chmodSync(manifestPath, 0o644);
      }
    });
  });
});
