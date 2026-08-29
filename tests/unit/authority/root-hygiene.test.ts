import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RootDirectoryHygieneGuard } from "../../../olt/scripts/src/authority/guards/root-hygiene.ts";
import {
  checkRepositoryHygiene,
  purgeOrphanedScratch,
} from "../../../olt/scripts/src/reporting/doctor/hygiene-engine.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Wave 1 - Task 1.3: Repository Hygiene Guard (Invariant 30)", () => {
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
      const repo = await mkdtemp(join(tmpdir(), "hygiene-repo-"));
      roots.push(repo);

      // Create approved file
      writeFileSync(join(repo, "package.json"), "{}");

      // Create loose scratch file in root
      writeFileSync(join(repo, "fix-test.ts"), "console.log('fix');");

      const checkBefore = checkRepositoryHygiene({ repoRoot: repo });
      expect(checkBefore.passed).toBe(false);
      expect(checkBefore.violations.length).toBeGreaterThan(0);
      expect(checkBefore.violations[0]?.violationType).toBe("UNCONFINED_SCRATCH_SCRIPT");

      const checkFixed = checkRepositoryHygiene({ repoRoot: repo, fix: true });
      expect(checkFixed.passed).toBe(false); // First run flags it
      expect(checkFixed.scrubbedFiles.length).toBeGreaterThan(0);

      // Second check should pass
      const checkAfter = checkRepositoryHygiene({ repoRoot: repo });
      expect(checkAfter.passed).toBe(true);
    });
  });
});
