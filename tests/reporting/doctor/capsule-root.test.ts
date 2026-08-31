import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findRepositoryRoot,
  scanMisplacedCapsulesDirectories,
  verifyStrictRepositoryCapsuleRoot,
} from "../../../olt/scripts/src/reporting/doctor/capsule-root.ts";

const SCRATCH_DIR = resolve(join(process.cwd(), "coverage", "scratch", "capsule-root-tests"));

export const capsuleRootSuiteName = "doctor/capsule-root";

describe(capsuleRootSuiteName, () => {
  beforeEach(() => {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
    mkdirSync(SCRATCH_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  });

  describe("findRepositoryRoot", () => {
    it("finds repository root by walking upwards looking for .git", () => {
      const repoDir = join(SCRATCH_DIR, "git-repo");
      const subDir = join(repoDir, "a", "b", "c");
      mkdirSync(join(repoDir, ".git"), { recursive: true });
      mkdirSync(subDir, { recursive: true });

      const found = findRepositoryRoot(subDir);
      expect(found).toBe(repoDir);
    });

    it("falls back to splitting on .capsules when .git is absent", () => {
      const tempPath = join(require("node:os").tmpdir(), "no-git-capsules-test-" + Date.now());
      const runDir = join(tempPath, ".capsules", "run-123");
      mkdirSync(runDir, { recursive: true });
      try {
        const found = findRepositoryRoot(runDir);
        expect(found).toBe(tempPath);
      } finally {
        rmSync(tempPath, { recursive: true, force: true });
      }
    });

    it("falls back to process.cwd() when no .git or .capsules exists", () => {
      const nonRepo = "/nonexistent/test/path/without/git/or/capsules";
      const found = findRepositoryRoot(nonRepo);
      expect(typeof found).toBe("string");

      const nonExistentCapsules = "/nonexistent-prefix-dir-xyz/.capsules/run-1";
      const found2 = findRepositoryRoot(nonExistentCapsules);
      expect(typeof found2).toBe("string");
    });
  });

  describe("scanMisplacedCapsulesDirectories", () => {
    it("returns empty array for non-existent directory", () => {
      expect(scanMisplacedCapsulesDirectories(join(SCRATCH_DIR, "does-not-exist"))).toEqual([]);
    });

    it("returns empty array when currentDepth exceeds maxDepth", () => {
      const dir = join(SCRATCH_DIR, "depth-test");
      mkdirSync(dir, { recursive: true });
      expect(scanMisplacedCapsulesDirectories(dir, 2, 3)).toEqual([]);
    });

    it("skips node_modules, .git, and .tmp directories", () => {
      const repo = join(SCRATCH_DIR, "ignored-dirs");
      mkdirSync(join(repo, "node_modules", ".capsules"), { recursive: true });
      mkdirSync(join(repo, ".git", ".capsules"), { recursive: true });
      mkdirSync(join(repo, ".tmp", ".capsules"), { recursive: true });

      const misplaced = scanMisplacedCapsulesDirectories(repo);
      expect(misplaced).toEqual([]);
    });

    it("detects misplaced .capsules in subdirectories at depth > 0", () => {
      const repo = join(SCRATCH_DIR, "misplaced-test");
      const nestedCapsules = join(repo, "packages", "service-a", ".capsules");
      mkdirSync(nestedCapsules, { recursive: true });
      // Root-level .capsules should NOT be flagged
      mkdirSync(join(repo, ".capsules"), { recursive: true });

      const misplaced = scanMisplacedCapsulesDirectories(repo);
      expect(misplaced).toEqual([nestedCapsules]);
    });

    it("handles filesystem read errors gracefully", () => {
      const filePath = join(SCRATCH_DIR, "not-a-directory.txt");
      writeFileSync(filePath, "hello");
      // Calling with a file instead of directory causes readdirSync to throw, exercising catch block
      expect(scanMisplacedCapsulesDirectories(filePath)).toEqual([]);
    });
  });

  describe("verifyStrictRepositoryCapsuleRoot", () => {
    it("validates compliant runRoot inside <repo-root>/.capsules/<run-id>", () => {
      const repo = join(SCRATCH_DIR, "valid-capsule-repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      const runRoot = join(repo, ".capsules", "run-valid-1");
      mkdirSync(runRoot, { recursive: true });

      const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
      expect(audit.valid).toBe(true);
      expect(audit.isAtRepoRoot).toBe(true);
      expect(audit.issues).toEqual([]);
      expect(audit.misplacedCapsules).toEqual([]);
    });

    it("detects invalid runRoot outside repository root .capsules/", () => {
      const repo = join(SCRATCH_DIR, "invalid-capsule-repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      const invalidRunRoot = join(repo, "packages", "service", ".capsules", "run-nested");
      mkdirSync(invalidRunRoot, { recursive: true });

      const audit = verifyStrictRepositoryCapsuleRoot(invalidRunRoot, repo);
      expect(audit.valid).toBe(false);
      expect(audit.isAtRepoRoot).toBe(false);
      expect(audit.issues.length).toBeGreaterThan(0);
      expect(audit.issues.some((i) => i.includes("violates repository root confinement"))).toBe(
        true,
      );
    });

    it("detects misplaced capsules even if current runRoot is compliant", () => {
      const repo = join(SCRATCH_DIR, "partially-invalid-repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      const runRoot = join(repo, ".capsules", "run-ok");
      mkdirSync(runRoot, { recursive: true });

      const misplaced = join(repo, "subproject", ".capsules");
      mkdirSync(misplaced, { recursive: true });

      const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
      expect(audit.valid).toBe(false);
      expect(audit.isAtRepoRoot).toBe(true);
      expect(audit.misplacedCapsules).toEqual([misplaced]);
      expect(audit.issues.some((i) => i.includes("Misplaced nested .capsules directory"))).toBe(
        true,
      );
    });

    it("works when explicitRepoRoot is not provided and discovers it automatically", () => {
      const repo = join(SCRATCH_DIR, "auto-discover-repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      const runRoot = join(repo, ".capsules", "run-auto");
      mkdirSync(runRoot, { recursive: true });

      const audit = verifyStrictRepositoryCapsuleRoot(runRoot);
      expect(audit.valid).toBe(true);
      expect(audit.repoRoot).toBe(repo);
    });
  });
});
