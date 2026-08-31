import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAssistantSkillDirs,
  migrateOwnedLegacyDeployment,
  orDefault,
  readJsonStringField,
} from "../../scripts/sync/skill-deployer.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { initFakeSkillsRepo, initFakeTargetOlt } from "./skill-deployer-fixtures.ts";

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

  test("returns true if valid installation manifest is already present", async () => {
    const root = scratchRoot(import.meta.path, "migrate-manifest-present");
    const targetOlt = join(root, "olt");
    initFakeTargetOlt(targetOlt, { homeRepoRoot: root });

    const manifest = {
      schema: "https://schemas.antigravity.dev/installation.json",
      version: 1,
      skill_name: "olt",
      runtime_version: "1.0.0",
      source_sha256: "fake-sha",
      installed_at: new Date().toISOString(),
      clients: ["claude"],
    };
    writeFileSync(join(targetOlt, "installation.json"), JSON.stringify(manifest, null, 2), "utf-8");

    const migrated = await migrateOwnedLegacyDeployment(targetOlt, root);
    expect(migrated).toBe(true);
  });
});
