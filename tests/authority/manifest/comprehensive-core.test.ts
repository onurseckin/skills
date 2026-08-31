import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

describe("Authority Manifest Comprehensive - Core & Loader", () => {
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
  spawns:
    - sub-worker
instructions: "Custom instructions here"
`;
    const contractFromYaml = parseRoleContract(yamlContent, "/path/to/test-agent.yaml");
    expect(contractFromYaml.role).toBe("test-agent");
    expect(contractFromYaml.tier).toBe(3);
    expect(contractFromYaml.domain).toBe("test-domain");
    expect(contractFromYaml.may).toEqual(["task:claim"]);
    expect(contractFromYaml.mustNot).toEqual(["edit_file"]);
    expect(contractFromYaml.commands).toEqual(["run:exec"]);
    expect(contractFromYaml.spawns).toEqual(["sub-worker"]);
    expect(contractFromYaml.body).toBe("Custom instructions here");

    const mdContent = `---
role: coordinator
tier: 2
domain: execution
permissions:
  may: [task:delegate]
  must_not: [task:implement]
  commands: [queue:wave]
  spawns: [implementer]
---
# Coordinator Body
`;
    const contractFromMd = parseRoleContract(mdContent, "/path/to/coordinator.md");
    expect(contractFromMd.role).toBe("coordinator");
    expect(contractFromMd.tier).toBe(2);
    expect(contractFromMd.domain).toBe("execution");
    expect(contractFromMd.may).toEqual(["task:delegate"]);
    expect(contractFromMd.mustNot).toEqual(["task:implement"]);
    expect(contractFromMd.commands).toEqual(["queue:wave"]);
    expect(contractFromMd.spawns).toEqual(["implementer"]);
    expect(contractFromMd.body).toBe("# Coordinator Body");
  });

  test("loadRoleContract and loadAgentManifest with custom directories and cache bypass", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "manifest-loader-test-"));
    const agentsDir = join(sandbox, "agents");
    mkdirSync(agentsDir, { recursive: true });

    const agentYaml = `
name: custom-worker
role: custom-worker
tier: 3
interface:
  display_name: "Custom Worker"
  short_description: "Executes custom tasks"
permissions:
  may: [task:claim]
  must_not: [run:complete]
  commands: [task:exec]
  spawns: []
`;
    writeFileSync(join(agentsDir, "custom-worker.yaml"), agentYaml, "utf-8");

    try {
      clearManifestCache();

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
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
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
