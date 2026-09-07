import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { RootDirectoryHygieneGuard } from "../../../olt/scripts/src/authority/guards/root-hygiene.ts";
import { checkRepositoryHygiene } from "../../../olt/scripts/src/reporting/doctor/hygiene-engine.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("Wave 1 - Task 1.3: Repository Hygiene Guard (Invariant 30)", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  describe("RootDirectoryHygieneGuard", () => {
    test("allows approved root files and directories", () => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath("/repo", "package.json");
        RootDirectoryHygieneGuard.assertAllowedWritePath("/repo", "olt/scripts/src/index.ts");
        RootDirectoryHygieneGuard.assertAllowedWritePath("/repo", "scratch/test.ts");
      }).not.toThrow();
    });

    test("throws PATH_SAFETY on unapproved root file", () => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath("/repo", "fix-scratch.ts");
      }).toThrow(/ROOT_HYGIENE_VIOLATION/u);
    });

    test("throws PATH_SAFETY on runtime pollution in olt/", () => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath("/repo", "olt/defects.jsonl");
      }).toThrow(/ROOT_HYGIENE_VIOLATION/u);
    });
  });

  describe("checkRepositoryHygiene & purgeOrphanedScratch", () => {
    test("detects unapproved loose files and migrates with fix=true", async () => {
      const repo = "/virtual/grants/hygiene-repo";
      const vfs = getVirtualAuthorityFS();
      vfs.mkdirSync(repo, { recursive: true });

      // Create approved file
      vfs.writeFileSync(join(repo, "package.json"), "{}");

      // Create loose scratch file in root
      vfs.writeFileSync(join(repo, "fix-test.ts"), "console.log('fix');");

      const checkBefore = checkRepositoryHygiene({ repoRoot: repo });
      expect(checkBefore.passed).toBe(false);
      expect(checkBefore.violations.length).toBeGreaterThan(0);
      expect(checkBefore.violations[0]?.violationType).toBe("UNCONFINED_SCRATCH_SCRIPT");

      const checkFixed = checkRepositoryHygiene({ repoRoot: repo, fix: true });
      expect(checkFixed.passed).toBe(false);
      expect(checkFixed.scrubbedFiles.length).toBeGreaterThan(0);

      // Second check should pass
      const checkAfter = checkRepositoryHygiene({ repoRoot: repo });
      expect(checkAfter.passed).toBe(true);
    });

    test("handles multiple loose scratch files, preserves approved files, and ensures fix idempotence", () => {
      const repo = "/virtual/grants/hygiene-multi-repo";
      const vfs = getVirtualAuthorityFS();
      vfs.mkdirSync(repo, { recursive: true });
      vfs.mkdirSync(join(repo, "scratch"), { recursive: true });

      // Create approved files that must be preserved
      vfs.writeFileSync(join(repo, "package.json"), '{"name": "test-pkg"}');
      vfs.writeFileSync(join(repo, "README.md"), "# Test Readme");
      vfs.writeFileSync(join(repo, "scratch", "script.ts"), "console.log('scratch');");

      // Create multiple unapproved loose files in root
      vfs.writeFileSync(join(repo, "fix-1.ts"), "console.log('1');");
      vfs.writeFileSync(join(repo, "patch.py"), "print('patch')");
      vfs.writeFileSync(join(repo, "debug.sh"), "#!/bin/sh\necho debug");

      // 1. Check before fix: should detect all 3 unapproved files
      const checkBefore = checkRepositoryHygiene({ repoRoot: repo });
      expect(checkBefore.passed).toBe(false);
      expect(checkBefore.violations.length).toBe(3);
      const violationPaths = checkBefore.violations.map((v) => v.path);
      expect(violationPaths.some((p) => p.endsWith("fix-1.ts"))).toBe(true);
      expect(violationPaths.some((p) => p.endsWith("patch.py"))).toBe(true);
      expect(violationPaths.some((p) => p.endsWith("debug.sh"))).toBe(true);

      // 2. Run with fix=true: should quarantine all 3
      const checkFixed = checkRepositoryHygiene({ repoRoot: repo, fix: true });
      expect(checkFixed.scrubbedFiles.length).toBe(3);

      // 3. Verify approved files were NOT touched or removed
      expect(vfs.existsSync(join(repo, "package.json"))).toBe(true);
      expect(vfs.readFileSync(join(repo, "package.json"), "utf8")).toBe('{"name": "test-pkg"}');
      expect(vfs.existsSync(join(repo, "README.md"))).toBe(true);
      expect(vfs.readFileSync(join(repo, "README.md"), "utf8")).toBe("# Test Readme");
      expect(vfs.existsSync(join(repo, "scratch", "script.ts"))).toBe(true);
      expect(vfs.readFileSync(join(repo, "scratch", "script.ts"), "utf8")).toBe(
        "console.log('scratch');",
      );

      // 4. Verify unapproved files were removed from repo root
      expect(vfs.existsSync(join(repo, "fix-1.ts"))).toBe(false);
      expect(vfs.existsSync(join(repo, "patch.py"))).toBe(false);
      expect(vfs.existsSync(join(repo, "debug.sh"))).toBe(false);

      // 5. Idempotence: subsequent fix=true should pass cleanly with 0 violations and 0 scrubbed files
      const checkSecondFix = checkRepositoryHygiene({ repoRoot: repo, fix: true });
      expect(checkSecondFix.passed).toBe(true);
      expect(checkSecondFix.violations.length).toBe(0);
      expect(checkSecondFix.scrubbedFiles.length).toBe(0);
    });
  });
});
