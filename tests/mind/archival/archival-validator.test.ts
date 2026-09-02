import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import * as safeFs from "../../../olt/scripts/src/core/shared/safe-fs/index.ts";
import {
  archiveCapsule,
  assertCapsuleCopyComplete,
  isEffectivelyEmptyDirectory,
  pruneCapsuleBoilerplate,
} from "../../../olt/scripts/src/mind/archival/validator.ts";

describe("Archival Validator Module", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archival-validator-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("isEffectivelyEmptyDirectory", () => {
    it("returns true for non-existent path", () => {
      expect(isEffectivelyEmptyDirectory(join(tempDir, "missing"))).toBe(true);
    });

    it("returns false for regular file", () => {
      const filePath = join(tempDir, "file.txt");
      writeFileSync(filePath, "content");
      expect(isEffectivelyEmptyDirectory(filePath)).toBe(false);
    });

    it("returns true for empty directory and directory with .DS_Store", () => {
      const emptyDir = join(tempDir, "empty");
      mkdirSync(emptyDir);
      expect(isEffectivelyEmptyDirectory(emptyDir)).toBe(true);

      const dsDir = join(tempDir, "ds-store");
      mkdirSync(dsDir);
      writeFileSync(join(dsDir, ".DS_Store"), "junk");
      expect(isEffectivelyEmptyDirectory(dsDir)).toBe(true);
    });

    it("returns true for nested empty directories", () => {
      const nested = join(tempDir, "nested", "level1", "level2");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, ".DS_Store"), "junk");
      expect(isEffectivelyEmptyDirectory(join(tempDir, "nested"))).toBe(true);
    });

    it("returns false when directory contains non-empty child file", () => {
      const dir = join(tempDir, "with-file");
      mkdirSync(dir);
      writeFileSync(join(dir, "data.json"), "{}");
      expect(isEffectivelyEmptyDirectory(dir)).toBe(false);
    });
  });

  describe("pruneCapsuleBoilerplate", () => {
    it("throws INVALID_ARGUMENT if capsulePath is missing or not a directory", () => {
      expect(() => pruneCapsuleBoilerplate(join(tempDir, "missing"))).toThrow(HarnessError);
      const filePath = join(tempDir, "a-file.txt");
      writeFileSync(filePath, "data");
      expect(() => pruneCapsuleBoilerplate(filePath)).toThrow(HarnessError);
    });

    it("prunes effectively empty boilerplate directories and preserves populated ones", () => {
      const capsule = join(tempDir, "capsule-1");
      mkdirSync(join(capsule, "blobs"), { recursive: true });
      mkdirSync(join(capsule, "commands"), { recursive: true });
      mkdirSync(join(capsule, "evidence"), { recursive: true });
      writeFileSync(join(capsule, "evidence", "proof.txt"), "proof");
      writeFileSync(join(capsule, "logs.txt"), "log-entry");

      const res = pruneCapsuleBoilerplate(capsule, {
        subdirectories: ["blobs", "commands", "evidence", "logs.txt", "nonexistent"],
      });

      expect(res.prunedDirectories).toContain("blobs");
      expect(res.prunedDirectories).toContain("commands");
      expect(res.preservedDirectories).toContain("evidence");
      expect(res.preservedDirectories).toContain("logs.txt");
      expect(existsSync(join(capsule, "blobs"))).toBe(false);
      expect(existsSync(join(capsule, "evidence"))).toBe(true);
    });

    it("respects dryRun option without deleting directories", () => {
      const capsule = join(tempDir, "capsule-dry");
      mkdirSync(join(capsule, "blobs"), { recursive: true });
      const res = pruneCapsuleBoilerplate(capsule, { dryRun: true });
      expect(res.prunedDirectories).toContain("blobs");
      expect(existsSync(join(capsule, "blobs"))).toBe(true);
    });
  });

  describe("assertCapsuleCopyComplete", () => {
    it("succeeds when source and target match, ignoring symlinks in manifest", () => {
      const src = join(tempDir, "src");
      const dst = join(tempDir, "dst");
      mkdirSync(join(src, "sub"), { recursive: true });
      mkdirSync(join(dst, "sub"), { recursive: true });
      writeFileSync(join(src, "sub", "file.txt"), "hello world");
      writeFileSync(join(dst, "sub", "file.txt"), "hello world");

      const linkSrc = join(src, "sub", "file.txt");
      const linkDst = join(src, "sub", "link.txt");
      try {
        symlinkSync(linkSrc, linkDst);
      } catch {}

      expect(() => assertCapsuleCopyComplete(src, dst)).not.toThrow();
    });

    it("throws INTEGRITY when targetRoot does not exist", () => {
      const src = join(tempDir, "src-missing-dst");
      mkdirSync(src);
      expect(() => assertCapsuleCopyComplete(src, join(tempDir, "nonexistent"))).toThrow(
        /copy target does not exist after cpSync/,
      );
    });

    it("throws INTEGRITY when target is missing files or file size mismatches", () => {
      const src = join(tempDir, "src-diff");
      const dst = join(tempDir, "dst-diff");
      mkdirSync(src);
      mkdirSync(dst);
      writeFileSync(join(src, "file1.txt"), "hello");
      expect(() => assertCapsuleCopyComplete(src, dst)).toThrow(/is missing 'file1.txt'/);

      writeFileSync(join(dst, "file1.txt"), "longer hello");
      expect(() => assertCapsuleCopyComplete(src, dst)).toThrow(/has size 12, expected 5/);
    });
  });

  describe("archiveCapsule", () => {
    it("throws INVALID_ARGUMENT when sourceCapsulePath does not exist or is a file", () => {
      expect(() => archiveCapsule(join(tempDir, "missing"))).toThrow(HarnessError);
      const f = join(tempDir, "file.txt");
      writeFileSync(f, "txt");
      expect(() => archiveCapsule(f)).toThrow(HarnessError);
    });

    it("throws INVALID_STATE if target already exists without overwrite", () => {
      const src = join(tempDir, "run-100");
      const archiveDir = join(tempDir, "archive");
      const target = join(archiveDir, "run-100");
      mkdirSync(src, { recursive: true });
      mkdirSync(target, { recursive: true });

      expect(() => archiveCapsule(src, { targetArchiveDir: archiveDir, overwrite: false })).toThrow(
        /Target archived capsule already exists/,
      );
    });

    it("overwrites existing target when overwrite is true", () => {
      const src = join(tempDir, "run-overwrite");
      const archiveDir = join(tempDir, "archive");
      const target = join(archiveDir, "run-overwrite");
      mkdirSync(src, { recursive: true });
      mkdirSync(target, { recursive: true });
      writeFileSync(join(src, "data.txt"), "fresh data");
      writeFileSync(join(target, "data.txt"), "old data");

      const res = archiveCapsule(src, { targetArchiveDir: archiveDir, overwrite: true });
      expect(res.archivedPath).toBe(target);
      expect(readFileSync(join(target, "data.txt"), "utf8")).toBe("fresh data");
    });

    it("performs rename move, prunes boilerplate, and respects custom targetArchiveDir", () => {
      const src = join(tempDir, "run-200");
      const archiveDir = join(tempDir, "custom-archive");
      mkdirSync(join(src, "blobs"), { recursive: true });
      mkdirSync(join(src, "evidence"), { recursive: true });
      writeFileSync(join(src, "evidence", "proof.txt"), "valid");

      const res = archiveCapsule(src, { targetArchiveDir: archiveDir, pruneBoilerplate: true });
      expect(res.runId).toBe("run-200");
      expect(existsSync(res.archivedPath)).toBe(true);
      expect(existsSync(src)).toBe(false);
      expect(existsSync(join(res.archivedPath, "blobs"))).toBe(false);
      expect(existsSync(join(res.archivedPath, "evidence", "proof.txt"))).toBe(true);
    });

    it("supports dryRun option without altering files", () => {
      const src = join(tempDir, "run-dry");
      mkdirSync(src, { recursive: true });
      const res = archiveCapsule(src, { dryRun: true });
      expect(existsSync(src)).toBe(true);
      expect(existsSync(res.archivedPath)).toBe(false);
    });

    it("supports pruneBoilerplate: false option", () => {
      const src = join(tempDir, "run-no-prune");
      mkdirSync(join(src, "blobs"), { recursive: true });
      const res = archiveCapsule(src, { pruneBoilerplate: false });
      expect(existsSync(join(res.archivedPath, "blobs"))).toBe(true);
      expect(res.prunedDirectories).toHaveLength(0);
    });

    it("falls back to cpSync, verification, and rmSync when safeRenameSync fails", () => {
      const src = join(tempDir, "run-fallback");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "item.txt"), "item data");

      const spy = spyOn(safeFs, "safeRenameSync").mockImplementation(() => {
        throw new Error("EXDEV: cross-device link not permitted");
      });

      try {
        const res = archiveCapsule(src);
        expect(existsSync(res.archivedPath)).toBe(true);
        expect(readFileSync(join(res.archivedPath, "item.txt"), "utf8")).toBe("item data");
        expect(existsSync(src)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it("rethrows HarnessError when safeRenameSync throws HarnessError", () => {
      const src = join(tempDir, "run-harness-err");
      mkdirSync(src, { recursive: true });

      const spy = spyOn(safeFs, "safeRenameSync").mockImplementation(() => {
        throw new HarnessError("INTEGRITY", "Security boundary violation");
      });

      try {
        expect(() => archiveCapsule(src)).toThrow(/Security boundary violation/);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
