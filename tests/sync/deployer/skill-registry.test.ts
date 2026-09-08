import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { deploySkill } from "../../../scripts/sync/skill-deployer.ts";
import {
  getSkillDefinition,
  SKILL_NAMES,
  SKILL_REGISTRY,
} from "../../../scripts/sync/skill-registry.ts";
import { validateDocumentationSkillSource } from "../../../scripts/sync/skill-source-validation.ts";
import { cleanupVirtualSyncFS, scratchRoot, setupVirtualSyncFS } from "../sync-fixture.ts";
import { initFakeSkillsRepo } from "./skill-deployer-fixtures.ts";

let vfs: ReturnType<typeof setupVirtualSyncFS>;

beforeEach(() => {
  vfs = setupVirtualSyncFS();
});

afterEach(() => {
  cleanupVirtualSyncFS();
});

describe("SKILL_REGISTRY", () => {
  test("declares exactly the three deployed skills with the correct kinds", () => {
    expect(SKILL_NAMES).toEqual(["olt", "chatroom", "agy-switch-helper"]);
    expect(SKILL_REGISTRY.map((entry) => entry.kind)).toEqual([
      "tooling",
      "tooling",
      "documentation",
    ]);
  });

  test("every entry's hasGlobalBinary flag agrees with its ensureBinaries map", () => {
    for (const entry of SKILL_REGISTRY) {
      expect(entry.hasGlobalBinary).toBe(Object.keys(entry.ensureBinaries).length > 0);
    }
  });

  test("agy-switch-helper is documentation-kind with no global binary", () => {
    const definition = getSkillDefinition("agy-switch-helper");
    expect(definition?.kind).toBe("documentation");
    expect(definition?.hasGlobalBinary).toBe(false);
    expect(Object.keys(definition?.ensureBinaries ?? {})).toHaveLength(0);
    expect(definition?.sourceSubdir).toBe("agy-switch-helper");
  });

  test("olt and chatroom remain tooling-kind with a global binary", () => {
    expect(getSkillDefinition("olt")?.kind).toBe("tooling");
    expect(getSkillDefinition("olt")?.hasGlobalBinary).toBe(true);
    expect(getSkillDefinition("chatroom")?.kind).toBe("tooling");
    expect(getSkillDefinition("chatroom")?.hasGlobalBinary).toBe(true);
  });

  test("getSkillDefinition returns undefined for an unregistered name", () => {
    expect(getSkillDefinition("not-a-real-skill")).toBeUndefined();
  });
});

describe("validateDocumentationSkillSource", () => {
  test("passes for a well-formed SKILL.md whose frontmatter name matches the directory", () => {
    const root = scratchRoot(import.meta.path, "doc-valid");
    vfs.mkdirSync(join(root, "agy-switch-helper"), { recursive: true });
    vfs.writeFileSync(
      join(root, "agy-switch-helper", "SKILL.md"),
      "---\nname: agy-switch-helper\ndescription: recovers a stuck worker session\n---\n\nbody\n",
      "utf-8",
    );

    expect(() =>
      validateDocumentationSkillSource(join(root, "agy-switch-helper"), "agy-switch-helper"),
    ).not.toThrow();
  });

  test("fails when SKILL.md is missing", () => {
    const root = scratchRoot(import.meta.path, "doc-missing-file");
    vfs.mkdirSync(join(root, "agy-switch-helper"), { recursive: true });

    expect(() =>
      validateDocumentationSkillSource(join(root, "agy-switch-helper"), "agy-switch-helper"),
    ).toThrow(/is missing SKILL\.md/);
  });

  test("fails when frontmatter name does not match the directory name", () => {
    const root = scratchRoot(import.meta.path, "doc-name-mismatch");
    vfs.mkdirSync(join(root, "agy-switch-helper"), { recursive: true });
    vfs.writeFileSync(
      join(root, "agy-switch-helper", "SKILL.md"),
      "---\nname: some-other-name\ndescription: recovers a stuck worker session\n---\n",
      "utf-8",
    );

    expect(() =>
      validateDocumentationSkillSource(join(root, "agy-switch-helper"), "agy-switch-helper"),
    ).toThrow(/does not match SKILL\.md frontmatter name 'some-other-name'/);
  });

  test("fails when frontmatter has no name field", () => {
    const root = scratchRoot(import.meta.path, "doc-missing-name");
    vfs.mkdirSync(join(root, "agy-switch-helper"), { recursive: true });
    vfs.writeFileSync(
      join(root, "agy-switch-helper", "SKILL.md"),
      "---\ndescription: recovers a stuck worker session\n---\n",
      "utf-8",
    );

    expect(() =>
      validateDocumentationSkillSource(join(root, "agy-switch-helper"), "agy-switch-helper"),
    ).toThrow(/missing a name/);
  });

  test("fails when frontmatter has no description field", () => {
    const root = scratchRoot(import.meta.path, "doc-missing-description");
    vfs.mkdirSync(join(root, "agy-switch-helper"), { recursive: true });
    vfs.writeFileSync(
      join(root, "agy-switch-helper", "SKILL.md"),
      "---\nname: agy-switch-helper\n---\n",
      "utf-8",
    );

    expect(() =>
      validateDocumentationSkillSource(join(root, "agy-switch-helper"), "agy-switch-helper"),
    ).toThrow(/missing a description/);
  });
});

describe("deploySkill agy-switch-helper", () => {
  test("deploys the documentation skill without a node_modules link", async () => {
    const root = scratchRoot(import.meta.path, "deploy-docs-success");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);
    vfs.mkdirSync(join(sourceRepo, "node_modules"), { recursive: true });
    vfs.mkdirSync(join(sourceRepo, "agy-switch-helper", "references"), { recursive: true });
    vfs.writeFileSync(
      join(sourceRepo, "agy-switch-helper", "SKILL.md"),
      "---\nname: agy-switch-helper\ndescription: recovers a stuck worker session\n---\n",
      "utf-8",
    );
    vfs.writeFileSync(
      join(sourceRepo, "agy-switch-helper", "references", "tmux-targeting.md"),
      "# tmux targeting\n",
      "utf-8",
    );

    const fakeHome = join(root, "home");
    const targetDocs = join(fakeHome, ".agents", "skills", "agy-switch-helper");

    const result = await deploySkill("agy-switch-helper", {
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      allowDirty: true,
    });

    expect(result.targetDir).toBe(targetDocs);
    expect(vfs.existsSync(join(targetDocs, "SKILL.md"))).toBe(true);
    expect(vfs.existsSync(join(targetDocs, "references", "tmux-targeting.md"))).toBe(true);
    expect(vfs.existsSync(join(targetDocs, "skill-config.json"))).toBe(true);
    expect(vfs.existsSync(join(targetDocs, "node_modules"))).toBe(false);
  });

  test("throws before writing anything to the target when SKILL.md name does not match the directory", async () => {
    const root = scratchRoot(import.meta.path, "deploy-docs-invalid");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);
    vfs.mkdirSync(join(sourceRepo, "agy-switch-helper"), { recursive: true });
    vfs.writeFileSync(
      join(sourceRepo, "agy-switch-helper", "SKILL.md"),
      "---\nname: wrong-name\ndescription: recovers a stuck worker session\n---\n",
      "utf-8",
    );

    const fakeHome = join(root, "home");
    const targetDocs = join(fakeHome, ".agents", "skills", "agy-switch-helper");

    await expect(
      deploySkill("agy-switch-helper", {
        sourceRepoRoot: sourceRepo,
        homeDir: fakeHome,
        allowDirty: true,
      }),
    ).rejects.toThrow(/does not match SKILL\.md frontmatter name/);

    expect(vfs.existsSync(targetDocs)).toBe(false);
  });

  test("throws when SKILL.md is entirely missing from the documentation skill source", async () => {
    const root = scratchRoot(import.meta.path, "deploy-docs-missing-skillmd");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);
    vfs.mkdirSync(join(sourceRepo, "agy-switch-helper"), { recursive: true });

    const fakeHome = join(root, "home");

    await expect(
      deploySkill("agy-switch-helper", {
        sourceRepoRoot: sourceRepo,
        homeDir: fakeHome,
        allowDirty: true,
      }),
    ).rejects.toThrow(/is missing SKILL\.md/);
  });
});
