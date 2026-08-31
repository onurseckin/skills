import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  deployCanonicalSkill,
  getAssistantSkillDirs,
  migrateOwnedLegacyDeployment,
  orDefault,
  readJsonStringField,
} from "../../../scripts/sync/skill-deployer.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

function initFakeSkillsRepo(repoRoot: string): void {
  mkdirSync(join(repoRoot, "olt", "scripts", "src"), { recursive: true });
  writeFileSync(
    join(repoRoot, "olt", "SKILL.md"),
    "---\nname: olt\ndescription: test\n---\n",
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "olt", "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", version: "1.0.0" }, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "olt", "scripts", "src", "constants.ts"),
    'export const RUNTIME_VERSION = "1.0.0";\n',
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "olt", "scripts", "harness.ts"),
    "console.log('harness');\n",
    "utf-8",
  );

  git(["init", "--quiet", "--initial-branch", "main"], repoRoot);
  git(["config", "user.email", "test@example.com"], repoRoot);
  git(["config", "user.name", "Test"], repoRoot);
  git(["add", "-A"], repoRoot);
  git(["commit", "--quiet", "-m", "init"], repoRoot);
}

function initFakeTargetOlt(
  targetOlt: string,
  options?: { homeRepoRoot?: string; policyRepoRoot?: string },
): void {
  mkdirSync(join(targetOlt, "scripts", "src"), { recursive: true });
  writeFileSync(join(targetOlt, "SKILL.md"), "---\nname: olt\ndescription: test\n---\n", "utf-8");
  writeFileSync(
    join(targetOlt, "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", version: "1.0.0" }, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(targetOlt, "scripts", "src", "constants.ts"),
    'export const RUNTIME_VERSION = "1.0.0";\n',
    "utf-8",
  );
  if (options?.homeRepoRoot) {
    writeFileSync(
      join(targetOlt, "skill-config.json"),
      JSON.stringify({ home_repo_root: options.homeRepoRoot }),
      "utf-8",
    );
  }
  if (options?.policyRepoRoot) {
    writeFileSync(
      join(targetOlt, "policy.json"),
      JSON.stringify({ skill_home_repo_root: options.policyRepoRoot }),
      "utf-8",
    );
  }
}

describe("getAssistantSkillDirs", () => {
  test("returns all 9 expected assistant skill paths", () => {
    const dirs = getAssistantSkillDirs("/Users/dummy");
    expect(dirs.length).toBe(9);
    expect(dirs).toContain("/Users/dummy/.gemini/config/skills");
    expect(dirs).toContain("/Users/dummy/.gemini/antigravity-cli/skills");
    expect(dirs).toContain("/Users/dummy/.gemini/antigravity-ide/skills");
    expect(dirs).toContain("/Users/dummy/.gemini/skills");
    expect(dirs).toContain("/Users/dummy/.claude/skills");
    expect(dirs).toContain("/Users/dummy/.cursor/skills");
    expect(dirs).toContain("/Users/dummy/.codex/skills");
    expect(dirs).toContain("/Users/dummy/.codex/vendor_imports/skills");
    expect(dirs).toContain("/Users/dummy/.openai/skills");
  });
});

describe("readJsonStringField and orDefault", () => {
  test("readJsonStringField handles missing file, invalid JSON, and non-string fields", () => {
    const root = scratchRoot(import.meta.path, "read-json-field");
    expect(readJsonStringField(join(root, "missing.json"), "foo")).toBeUndefined();

    const badJson = join(root, "bad.json");
    writeFileSync(badJson, "not json", "utf-8");
    expect(readJsonStringField(badJson, "foo")).toBeUndefined();

    const nullJson = join(root, "null.json");
    writeFileSync(nullJson, "null", "utf-8");
    expect(readJsonStringField(nullJson, "foo")).toBeUndefined();

    const numberJson = join(root, "number.json");
    writeFileSync(numberJson, "123", "utf-8");
    expect(readJsonStringField(numberJson, "foo")).toBeUndefined();

    const nonStringField = join(root, "non-string.json");
    writeFileSync(nonStringField, JSON.stringify({ count: 42 }), "utf-8");
    expect(readJsonStringField(nonStringField, "count")).toBeUndefined();

    const validField = join(root, "valid.json");
    writeFileSync(validField, JSON.stringify({ name: "hello" }), "utf-8");
    expect(readJsonStringField(validField, "name")).toBe("hello");
  });

  test("orDefault returns value when defined and fallback when undefined", () => {
    expect(orDefault("val", "fallback")).toBe("val");
    expect(orDefault(undefined, "fallback")).toBe("fallback");
  });
});

describe("migrateOwnedLegacyDeployment", () => {
  test("returns false if targetOlt directory does not exist", async () => {
    const root = scratchRoot(import.meta.path, "migrate-not-exist");
    const migrated = await migrateOwnedLegacyDeployment(join(root, "non-existent"), root);
    expect(migrated).toBe(false);
  });

  test("returns true if installation is already identified", async () => {
    const root = scratchRoot(import.meta.path, "migrate-already-identified");
    const targetOlt = join(root, "olt");
    initFakeTargetOlt(targetOlt, { homeRepoRoot: root });

    // First migrate seals manifest
    const firstMigrate = await migrateOwnedLegacyDeployment(targetOlt, root);
    expect(firstMigrate).toBe(true);

    // Second call should detect identified installation
    const secondMigrate = await migrateOwnedLegacyDeployment(targetOlt, root);
    expect(secondMigrate).toBe(true);
  });

  test("throws if legacy directory is not owned by the source checkout", async () => {
    const root = scratchRoot(import.meta.path, "migrate-untrusted");
    const targetOlt = join(root, "olt");
    mkdirSync(targetOlt, { recursive: true });
    writeFileSync(
      join(targetOlt, "skill-config.json"),
      JSON.stringify({ home_repo_root: "/unrelated/other/repo" }),
      "utf-8",
    );

    expect(migrateOwnedLegacyDeployment(targetOlt, root)).rejects.toThrow(
      /refusing to replace untrusted global skill directory/,
    );
  });

  test("migrates owned legacy directory with skill-config.json matching home_repo_root", async () => {
    const root = scratchRoot(import.meta.path, "migrate-owned-skill-config");
    initFakeSkillsRepo(root);

    const targetOlt = join(root, "target-olt");
    initFakeTargetOlt(targetOlt, { homeRepoRoot: root });

    const migrated = await migrateOwnedLegacyDeployment(targetOlt, root);
    expect(migrated).toBe(true);
    expect(existsSync(join(targetOlt, "installation.json"))).toBe(true);
  });

  test("migrates owned legacy directory with policy.json matching skill_home_repo_root", async () => {
    const root = scratchRoot(import.meta.path, "migrate-owned-policy");
    initFakeSkillsRepo(root);

    const targetOlt = join(root, "target-olt");
    initFakeTargetOlt(targetOlt, { policyRepoRoot: root });

    const migrated = await migrateOwnedLegacyDeployment(targetOlt, root);
    expect(migrated).toBe(true);
    expect(existsSync(join(targetOlt, "installation.json"))).toBe(true);
  });
});

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

  test("handles existing installation.json during legacy migration", async () => {
    const root = scratchRoot(import.meta.path, "migrate-existing-manifest");
    initFakeSkillsRepo(root);

    const targetOlt = join(root, "target-olt");
    initFakeTargetOlt(targetOlt, { homeRepoRoot: root });
    // Pre-create installation.json with invalid/stale content to trigger chmodSync branch
    writeFileSync(join(targetOlt, "installation.json"), "{}", "utf-8");

    const migrated = await migrateOwnedLegacyDeployment(targetOlt, root);
    expect(migrated).toBe(true);
  });

  test("handles legacyHomePurged failure when legacy home is an un-deletable git repo", async () => {
    const root = scratchRoot(import.meta.path, "deploy-legacy-git-repo");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    const legacyHome = join(fakeHome, ".agents", "skills", "orchestrating-long-tasks");
    mkdirSync(legacyHome, { recursive: true });
    git(["init", "--quiet", "--initial-branch", "main"], legacyHome); // Contains .git -> guardedRemoveSync throws

    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const result = await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });

    expect(result.legacyHomePurged).toBe(false);
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
