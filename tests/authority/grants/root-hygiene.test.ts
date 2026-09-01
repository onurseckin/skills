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
  });
});
