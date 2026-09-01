import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  findRepositoryRoot,
  scanMisplacedCapsulesDirectories,
  verifyStrictRepositoryCapsuleRoot,
} from "../../../olt/scripts/src/reporting/doctor/capsule-root.ts";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const VIRTUAL_SCRATCH_DIR = "/virtual/capsule-root-tests";

export const capsuleRootSuiteName = "doctor/capsule-root";

describe(capsuleRootSuiteName, () => {
  let vfs: VirtualMemoryFS;
  let spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(VIRTUAL_SCRATCH_DIR, { recursive: true });

    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      return vfs.existsSync(String(p));
    });

    const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p, opts) => {
      return vfs.mkdirSync(String(p), opts as Parameters<typeof vfs.mkdirSync>[1]);
    });

    const writeFileSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
      vfs.writeFileSync(
        String(p),
        typeof data === "string" ? data : Buffer.from(data as Uint8Array),
      );
    });

    const readFileSpy = spyOn(fs, "readFileSync").mockImplementation((p, opts) => {
      if (typeof opts === "string" || (typeof opts === "object" && opts?.encoding)) {
        return vfs.readFileSync(String(p), "utf8");
      }
      return vfs.readFileSync(String(p));
    });

    const readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, opts) => {
      if (typeof opts === "object" && opts?.withFileTypes) {
        return vfs.readdirSync(String(p), { withFileTypes: true }) as unknown as fs.Dirent[];
      }
      return vfs.readdirSync(String(p)) as unknown as string[];
    });

    const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
      const s = vfs.statSync(String(p));
      if (!s) throw new Error(`ENOENT: no such file or directory, stat '${String(p)}'`);
      return {
        isFile: () => s.isFile(),
        isDirectory: () => s.isDirectory(),
        size: s.size,
        mtime: s.mtime,
        mtimeMs: s.mtimeMs,
        birthtime: s.birthtime,
        birthtimeMs: s.birthtimeMs,
        atime: s.atime,
        atimeMs: s.atimeMs,
        ctime: s.ctime,
        ctimeMs: s.ctimeMs,
        mode: s.mode,
      } as unknown as fs.Stats;
    });

    const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => String(p));

    spies = [existsSpy, mkdirSpy, writeFileSpy, readFileSpy, readdirSpy, statSpy, realpathSpy];
  });

  afterEach(() => {
    for (const s of spies) {
      s.mockRestore();
    }
    spies = [];
  });

  describe("findRepositoryRoot", () => {
    it("finds repository root by walking upwards looking for .git", () => {
      const repoDir = join(VIRTUAL_SCRATCH_DIR, "git-repo");
      const subDir = join(repoDir, "a", "b", "c");
      vfs.mkdirSync(join(repoDir, ".git"), { recursive: true });
      vfs.mkdirSync(subDir, { recursive: true });

      const found = findRepositoryRoot(subDir);
      expect(found).toBe(repoDir);
    });

    it("falls back to splitting on .capsules when .git is absent", () => {
      const tempPath = join(VIRTUAL_SCRATCH_DIR, "no-git-capsules-test");
      const runDir = join(tempPath, ".capsules", "run-123");
      vfs.mkdirSync(runDir, { recursive: true });
      const found = findRepositoryRoot(runDir);
      expect(found).toBe(tempPath);
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
      expect(scanMisplacedCapsulesDirectories(join(VIRTUAL_SCRATCH_DIR, "does-not-exist"))).toEqual(
        [],
      );
    });

    it("returns empty array when currentDepth exceeds maxDepth", () => {
      const dir = join(VIRTUAL_SCRATCH_DIR, "depth-test");
      vfs.mkdirSync(dir, { recursive: true });
      expect(scanMisplacedCapsulesDirectories(dir, 2, 3)).toEqual([]);
    });

    it("skips node_modules, .git, and .tmp directories", () => {
      const repo = join(VIRTUAL_SCRATCH_DIR, "ignored-dirs");
      vfs.mkdirSync(join(repo, "node_modules", ".capsules"), { recursive: true });
      vfs.mkdirSync(join(repo, ".git", ".capsules"), { recursive: true });
      vfs.mkdirSync(join(repo, ".tmp", ".capsules"), { recursive: true });

      const misplaced = scanMisplacedCapsulesDirectories(repo);
      expect(misplaced).toEqual([]);
    });

    it("detects misplaced .capsules in subdirectories at depth > 0", () => {
      const repo = join(VIRTUAL_SCRATCH_DIR, "misplaced-test");
      const nestedCapsules = join(repo, "packages", "service-a", ".capsules");
      vfs.mkdirSync(nestedCapsules, { recursive: true });
      // Root-level .capsules should NOT be flagged
      vfs.mkdirSync(join(repo, ".capsules"), { recursive: true });

      const misplaced = scanMisplacedCapsulesDirectories(repo);
      expect(misplaced).toEqual([nestedCapsules]);
    });

    it("handles filesystem read errors gracefully", () => {
      const filePath = join(VIRTUAL_SCRATCH_DIR, "not-a-directory.txt");
      vfs.writeFileSync(filePath, "hello");
      // Calling with a file instead of directory causes readdirSync to throw, exercising catch block
      expect(scanMisplacedCapsulesDirectories(filePath)).toEqual([]);
    });
  });

  describe("verifyStrictRepositoryCapsuleRoot", () => {
    it("validates compliant runRoot inside <repo-root>/.capsules/<run-id>", () => {
      const repo = join(VIRTUAL_SCRATCH_DIR, "valid-capsule-repo");
      vfs.mkdirSync(join(repo, ".git"), { recursive: true });
      const runRoot = join(repo, ".capsules", "run-valid-1");
      vfs.mkdirSync(runRoot, { recursive: true });

      const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
      expect(audit.valid).toBe(true);
      expect(audit.isAtRepoRoot).toBe(true);
      expect(audit.issues).toEqual([]);
      expect(audit.misplacedCapsules).toEqual([]);
    });

    it("detects invalid runRoot outside repository root .capsules/", () => {
      const repo = join(VIRTUAL_SCRATCH_DIR, "invalid-capsule-repo");
      vfs.mkdirSync(join(repo, ".git"), { recursive: true });
      const invalidRunRoot = join(repo, "packages", "service", ".capsules", "run-nested");
      vfs.mkdirSync(invalidRunRoot, { recursive: true });

      const audit = verifyStrictRepositoryCapsuleRoot(invalidRunRoot, repo);
      expect(audit.valid).toBe(false);
      expect(audit.isAtRepoRoot).toBe(false);
      expect(audit.issues.length).toBeGreaterThan(0);
      expect(audit.issues.some((i) => i.includes("violates repository root confinement"))).toBe(
        true,
      );
    });

    it("detects misplaced capsules even if current runRoot is compliant", () => {
      const repo = join(VIRTUAL_SCRATCH_DIR, "partially-invalid-repo");
      vfs.mkdirSync(join(repo, ".git"), { recursive: true });
      const runRoot = join(repo, ".capsules", "run-ok");
      vfs.mkdirSync(runRoot, { recursive: true });

      const misplaced = join(repo, "subproject", ".capsules");
      vfs.mkdirSync(misplaced, { recursive: true });

      const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
      expect(audit.valid).toBe(false);
      expect(audit.isAtRepoRoot).toBe(true);
      expect(audit.misplacedCapsules).toEqual([misplaced]);
      expect(audit.issues.some((i) => i.includes("Misplaced nested .capsules directory"))).toBe(
        true,
      );
    });

    it("works when explicitRepoRoot is not provided and discovers it automatically", () => {
      const repo = join(VIRTUAL_SCRATCH_DIR, "auto-discover-repo");
      vfs.mkdirSync(join(repo, ".git"), { recursive: true });
      const runRoot = join(repo, ".capsules", "run-auto");
      vfs.mkdirSync(runRoot, { recursive: true });

      const audit = verifyStrictRepositoryCapsuleRoot(runRoot);
      expect(audit.valid).toBe(true);
      expect(audit.repoRoot).toBe(repo);
    });
  });
});
