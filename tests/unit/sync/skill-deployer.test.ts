import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deployCanonicalSkill } from "../../../scripts/sync/skill-deployer.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { git, initFakeSkillsRepo } from "./skill-deployer-fixtures.ts";

describe("deployCanonicalSkill", () => {
  test("throws if sourceRepoRoot is not a valid skills repo checkout", async () => {
    const root = scratchRoot(import.meta.path, "deploy-invalid-repo");
    expect(deployCanonicalSkill({ sourceRepoRoot: root })).rejects.toThrow(
      /does not look like the skills repository/,
    );
  });

  test("successfully deploys canonical skill to target and links assistant dirs", async () => {
    const root = scratchRoot(import.meta.path, "deploy-canonical-success");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    // Create fake node_modules
    mkdirSync(join(sourceRepo, "node_modules"), { recursive: true });

    // Create fake legacy home
    const fakeHome = join(root, "home");
    const legacyHome = join(fakeHome, ".agents", "skills", "orchestrating-long-tasks");
    mkdirSync(legacyHome, { recursive: true });
    writeFileSync(join(legacyHome, "old.txt"), "legacy\n", "utf-8");

    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const result = await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });

    expect(result.targetDir).toBe(targetOlt);
    expect(result.assistantDirsCount).toBe(9);
    expect(result.syncedCount + result.skippedCount).toBe(9);
    expect(result.syncedCount).toBeGreaterThan(0);
    expect(result.legacyHomePurged).toBe(true);

    expect(existsSync(join(targetOlt, "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetOlt, "skill-config.json"))).toBe(true);
    expect(existsSync(join(targetOlt, "node_modules"))).toBe(true);
    expect(existsSync(legacyHome)).toBe(false);

    // Run a second time to test idempotency / skippedCount
    const result2 = await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });

    expect(result2.syncedCount).toBe(0);
    expect(result2.skippedCount).toBe(9);
  });

  test("purges legacy home even when it contains a git repo", async () => {
    const root = scratchRoot(import.meta.path, "deploy-legacy-git-repo");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    const legacyHome = join(fakeHome, ".agents", "skills", "orchestrating-long-tasks");
    mkdirSync(legacyHome, { recursive: true });
    git(["init", "--quiet", "--initial-branch", "main"], legacyHome); // Contains .git -> safely purged with override

    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const result = await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });

    expect(result.legacyHomePurged).toBe(true);
    expect(existsSync(legacyHome)).toBe(false);
  });

  test("handles legacyHomePurged failure when legacy home cannot be deleted", async () => {
    const root = scratchRoot(import.meta.path, "deploy-legacy-purge-failure");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    const skillsDir = join(fakeHome, ".agents", "skills");
    const legacyHome = join(skillsDir, "orchestrating-long-tasks");
    const unremovableSub = join(legacyHome, "unremovable");
    mkdirSync(unremovableSub, { recursive: true });
    writeFileSync(join(unremovableSub, "file.txt"), "cannot delete", "utf-8");

    // Make subdirectory non-executable so rmSync cannot traverse or unlink its contents
    chmodSync(unremovableSub, 0o000);

    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    try {
      const result = await deployCanonicalSkill({
        sourceRepoRoot: sourceRepo,
        homeDir: fakeHome,
        targetOltDir: targetOlt,
        allowDirty: true,
      });

      expect(result.legacyHomePurged).toBe(false);
    } finally {
      chmodSync(unremovableSub, 0o755);
    }
  });

  test("handles assistant directory processing error gracefully via catch block", async () => {
    const root = scratchRoot(import.meta.path, "deploy-assistant-dir-error");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    // Place a plain file where an assistant directory is expected to cause mkdirSync to throw
    const blockedDir = join(fakeHome, ".cursor");
    mkdirSync(fakeHome, { recursive: true });
    writeFileSync(blockedDir, "blocking-file", "utf-8");

    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const result = await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });

    expect(result.targetDir).toBe(targetOlt);
  });
});
