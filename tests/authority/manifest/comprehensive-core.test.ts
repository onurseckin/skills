import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
  clearManifestCache,
  findSkillRoot,
  listAvailableManifests,
  listAvailableRoles,
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
  normalizeRoleName,
  parseMarkdownFrontmatter,
  parseRoleContract,
} from "../../../olt/scripts/src/authority/manifest/index.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("Authority Manifest Comprehensive - Core & Loader", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
    clearManifestCache();
  });

  afterEach(() => {
    clearManifestCache();
    cleanupVirtualAuthorityFS();
  });

  test("normalizeRoleName applies alias mappings and normalizes string", () => {
    expect(normalizeRoleName("coord")).toBe("coordinator");
    expect(normalizeRoleName("orch")).toBe("orchestrator");
    expect(normalizeRoleName("tier_0")).toBe("mind");
    expect(normalizeRoleName("UNKNOWN_CUSTOM_ROLE ")).toBe("unknown_custom_role");
  });

  test("findSkillRoot handles custom startDir and search hierarchy", () => {
    const root = findSkillRoot(process.cwd());
    expect(root).toBeDefined();
    expect(typeof root).toBe("string");
  });

  test("parseMarkdownFrontmatter edge cases", () => {
    expect(parseMarkdownFrontmatter("just plain text")).toEqual({
      frontmatter: {},
      body: "just plain text",
    });
    expect(parseMarkdownFrontmatter("---\nkey: val\nno closing delimiter")).toEqual({
      frontmatter: {},
      body: "---\nkey: val\nno closing delimiter",
    });
    const parsed = parseMarkdownFrontmatter<{ role: string }>(
      "---\nrole: custom\n---\n# Header\nBody text",
    );
    expect(parsed.frontmatter.role).toBe("custom");
    expect(parsed.body).toBe("# Header\nBody text");
  });

  test("parseRoleContract parses frontmatter markdown and plain yaml fallback", () => {
    const yamlContent = `
name: test-agent
role: test-agent
tier: 3
domain: test-domain
permissions:
  may:
    - task:claim
  must_not:
    - edit_file
  commands:
    - run:exec
`;
    const parsedYaml = parseRoleContract(yamlContent, "test-agent.yaml");
    expect(parsedYaml.role).toBe("test-agent");
    expect(parsedYaml.tier).toBe(3);
    expect(parsedYaml.may).toContain("task:claim");
    expect(parsedYaml.mustNot).toContain("edit_file");

    const mdContent = `---
name: doc-agent
role: doc-agent
tier: 2
permissions:
  may:
    - audit:read
---
# Instructions
Markdown instructions body here.
`;
    const parsedMd = parseRoleContract(mdContent, "doc-agent.md");
    expect(parsedMd.role).toBe("doc-agent");
    expect(parsedMd.tier).toBe(2);
    expect(parsedMd.body).toContain("Markdown instructions body here.");
    expect(parsedMd.may).toContain("audit:read");
  });

  test("loads custom agent manifests and contracts from sandbox directory", () => {
    const sandbox = "/virtual/manifest/test-sandbox";
    const agentsDir = join(sandbox, "agents");
    const vfs = getVirtualAuthorityFS();
    vfs.mkdirSync(agentsDir, { recursive: true });

    const customAgentYaml = `
name: custom-worker
role: custom-worker
tier: 3
interface:
  display_name: Custom Worker
  short_description: Scoped execution worker
permissions:
  may:
    - task:claim
  must_not:
    - modify_core
`;
    vfs.writeFileSync(join(agentsDir, "custom-worker.yaml"), customAgentYaml);

    const customAgentMd = `---
name: custom-worker
role: custom-worker
tier: 3
interface:
  display_name: Custom Worker
  short_description: Scoped execution worker
permissions:
  may:
    - task:claim
  must_not:
    - modify_core
---
# Instructions
Custom worker autonomous execution instructions.
`;
    vfs.writeFileSync(join(agentsDir, "custom-worker.md"), customAgentMd);

    const loadedManifest = loadAgentManifest("custom-worker", { agentsDir, bypassCache: true });
    expect(loadedManifest.name).toBe("custom-worker");

    const loadedContract = loadRoleContract("custom-worker", { agentsDir, bypassCache: true });
    expect(loadedContract.role).toBe("custom-worker");
    expect(loadedContract.tier).toBe(3);

    const unified = loadUnifiedAgentModel("custom-worker", { agentsDir, bypassCache: true });
    expect(unified.role).toBe("custom-worker");
    expect(unified.displayName).toBe("Custom Worker");
    expect(unified.archetype).toBe("Autonomous Worker");

    const fallbackModel = loadUnifiedAgentModel("non-existent-role-xyz", {
      agentsDir,
      bypassCache: true,
    });
    expect(fallbackModel.role).toBe("non-existent-role-xyz");
    expect(fallbackModel.tier).toBe(3);

    const roles = listAvailableRoles({ agentsDir });
    expect(roles).toContain("custom-worker");
    const manifests = listAvailableManifests({ agentsDir });
    expect(manifests).toContain("custom-worker");
  });

  test("getArchetypeAndMandate archetypes across all tier levels", () => {
    expect(loadUnifiedAgentModel("mind").archetype).toBe(
      "Autonomous Consciousness & Observe-Only Lead",
    );
    expect(loadUnifiedAgentModel("orchestrator").archetype).toBe(
      "Plan Supervisor & Multi-Round Release Manager",
    );
    expect(loadUnifiedAgentModel("coordinator").archetype).toBe("Wave Execution & Lease Manager");
    expect(loadUnifiedAgentModel("validator").archetype).toBe(
      "Adversarial Verifier & Quantitative Gate Inspector",
    );
    expect(loadUnifiedAgentModel("implementer").archetype).toBe("Scoped Modular Implementer");
    expect(loadUnifiedAgentModel("completeness-critic").archetype).toBe(
      "Run Completeness & Verification Critic",
    );
  });

  test("findSkillRoot fallback when agents dir is not found", () => {
    const rootWithMod = findSkillRoot(undefined, () => false, "/custom/path/to/mod");
    expect(rootWithMod).toBe(resolve("/custom/path/to/mod", "../../../.."));

    const rootWithCwd = findSkillRoot(undefined, () => false, null);
    expect(rootWithCwd).toBe(process.cwd());

    const root = findSkillRoot("/tmp/nonexistent-root-dir-for-test");
    expect(root).toBeDefined();
    expect(typeof root).toBe("string");
  });

  test("parseRoleContract edge cases without role or filePath", () => {
    const noRoleYaml = "tier: 3\ninstructions: 'no role defined'";
    const parsed = parseRoleContract(noRoleYaml);
    expect(parsed.role).toBe("agent");
    expect(parsed.tier).toBe(3);

    const noRoleMd = "---\ntier: 2\n---\nbody text";
    const parsedMd = parseRoleContract(noRoleMd);
    expect(parsedMd.role).toBe("unknown");
    expect(parsedMd.tier).toBe(2);
  });
});
