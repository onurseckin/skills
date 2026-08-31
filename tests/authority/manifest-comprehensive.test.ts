import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  parseAgentManifest,
  parseMarkdownFrontmatter,
  parseRoleContract,
  parseYaml,
} from "../../olt/scripts/src/authority/manifest/index.ts";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type UnifiedAgentManifest,
} from "../../olt/scripts/src/authority/manifest-schema.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Authority Manifest Schema, Parsers, Discovery and Loader Comprehensive", () => {
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
    // Missing delimiter or non-frontmatter
    expect(parseMarkdownFrontmatter("just plain text")).toEqual({
      frontmatter: {},
      body: "just plain text",
    });
    // Single delimiter only
    expect(parseMarkdownFrontmatter("---\nkey: val\nno closing delimiter")).toEqual({
      frontmatter: {},
      body: "---\nkey: val\nno closing delimiter",
    });
    // Valid frontmatter with custom body
    const parsed = parseMarkdownFrontmatter<{ role: string }>(
      "---\nrole: custom\n---\n# Header\nBody text",
    );
    expect(parsed.frontmatter.role).toBe("custom");
    expect(parsed.body).toBe("# Header\nBody text");
  });

  test("parseRoleContract parses frontmatter markdown and plain yaml fallback", () => {
    // YAML-style manifest passed to parseRoleContract
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

    // Markdown frontmatter style with alternate permission nesting
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

  test("parseUnifiedAgentManifest and validateUnifiedAgentManifest complete error paths", () => {
    // Non-object YAML throws error
    expect(() => parseUnifiedAgentManifest("just a string")).toThrow(
      "YAML document must be an object",
    );
    expect(() => parseUnifiedAgentManifest("- item1\n- item2")).toThrow(
      "YAML document must be an object",
    );

    // Complete valid manifest with communication_contract, turn1 actions, and dispatch contract
    const fullYaml = `
name: custom-mind
role: mind
tier: independent
provider:
  - antigravity
  - claude
tools:
  enable_subagent_tools: true
  enable_write_tools: false
interface:
  display_name: "Mind Lead"
  short_description: "Top-level supervisor"
permissions:
  may:
    - pulse:cycle
  must_not:
    - code:edit
  commands:
    - run:exec
  spawns:
    - orchestrator
invariants:
  - "Invariant 1"
domain: "core-mind"
protocol:
  cli: "bun harness.ts"
  zero_json: true
instructions: "Full instructions here"
communication_contract:
  protocol: "mailbox_ipc"
  mailbox_path: ".olt/mailboxes/{agent_id}/"
  lock_path: ".olt/locks/{agent_id}.lock"
  allowed_channels:
    - "msg:send"
  ban_raw_jsonl_reading: true
  forbid_native_messaging: true
mandatory_turn1_actions:
  - "whoami"
dispatch_contract: "custom_dispatch_spec"
`;
    const manifest = parseUnifiedAgentManifest(fullYaml, "custom-mind.yaml");
    expect(manifest.tier).toBe("independent");
    expect(manifest.communication_contract?.forbid_native_messaging).toBe(true);
    expect(manifest.mandatory_turn1_actions).toEqual(["whoami"]);
    expect(manifest.dispatch_contract).toBe("custom_dispatch_spec");

    const validResult = validateUnifiedAgentManifest(manifest);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors.length).toBe(0);

    // Validation failures across all fields
    const invalidManifest: UnifiedAgentManifest = {
      name: 123 as unknown as string,
      role: null as unknown as string,
      tier: "invalid-tier" as unknown as number,
      provider: ["valid", 456 as unknown as string],
      tools: {
        enable_subagent_tools: "not-bool" as unknown as boolean,
        enable_write_tools: 123 as unknown as boolean,
      },
      interface: {
        display_name: {} as unknown as string,
        short_description: [] as unknown as string,
      },
      permissions: {
        may: [123] as unknown as string[],
        must_not: "not-array" as unknown as string[],
        commands: [false] as unknown as string[],
        spawns: [null] as unknown as string[],
      },
      invariants: [123 as unknown as string],
      protocol: {
        cli: 999 as unknown as string,
        zero_json: "not-bool" as unknown as boolean,
      },
      instructions: 456 as unknown as string,
      communication_contract: {
        protocol: 123 as unknown as string,
        mailbox_path: 456 as unknown as string,
        lock_path: 789 as unknown as string,
        allowed_channels: [123] as unknown as string[],
        ban_raw_jsonl_reading: "not-bool" as unknown as boolean,
        forbid_native_messaging: "not-bool" as unknown as boolean,
      },
      mandatory_turn1_actions: [999 as unknown as string],
      dispatch_contract: 888 as unknown as string,
    };

    const invalidResult = validateUnifiedAgentManifest(invalidManifest);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(10);
  });

  test("loadRoleContract and loadAgentManifest with custom directories and cache bypass", () => {
    const scratch = scratchRoot(import.meta.path, "manifest-loader-test");
    const agentsDir = join(scratch, "agents");
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

    // Fallback for non-existent role
    const fallbackModel = loadUnifiedAgentModel("non-existent-role-xyz", {
      agentsDir,
      bypassCache: true,
    });
    expect(fallbackModel.role).toBe("non-existent-role-xyz");
    expect(fallbackModel.tier).toBe(3);

    // List available roles & manifests
    const roles = listAvailableRoles({ agentsDir });
    expect(roles).toContain("custom-worker");
    const manifests = listAvailableManifests({ agentsDir });
    expect(manifests).toContain("custom-worker");

    rmSync(scratch, { recursive: true, force: true });
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
    // When customExists returns false and customModuleDir is provided
    const rootWithMod = findSkillRoot(undefined, () => false, "/custom/path/to/mod");
    expect(rootWithMod).toBe(resolve("/custom/path/to/mod", "../../../.."));

    // When customExists returns false and customModuleDir is null
    const rootWithCwd = findSkillRoot(undefined, () => false, null);
    expect(rootWithCwd).toBe(process.cwd());

    // When startDir has no agents dir in its tree
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

  test("parseYaml block scalar variations and advanced structures", () => {
    // Empty & whitespace
    expect(parseYaml("")).toEqual({});
    expect(parseYaml("   \n\t  \n")).toEqual({});

    // JSON parse fallback
    expect(parseYaml('{"jsonKey": 123}')).toEqual({ jsonKey: 123 });
    expect(parseYaml("[10, 20, 30]")).toEqual([10, 20, 30]);

    // Single scalar line
    expect(parseYaml("single_scalar_value")).toBe("single_scalar_value");
    expect(parseYaml("42")).toBe(42);

    // List item with block scalar
    const listBlockScalar = `
items:
  - desc: |
      first line
      second line
  - name: item2
`;
    const parsedList = parseYaml(listBlockScalar) as {
      items: Array<{ desc?: string; name?: string }>;
    };
    expect(parsedList.items[0]?.desc).toContain("first line\nsecond line");
    expect(parsedList.items[1]?.name).toBe("item2");

    // List item with empty value after colon
    const listEmptyVal = `
items:
  - key1:
    nested: val
  - key2:
`;
    const parsedEmpty = parseYaml(listEmptyVal) as Record<string, unknown>;
    expect(parsedEmpty.items).toBeDefined();

    // Folded block scalar
    const foldedYaml = `
folded: >
  line one
  line two

  line three after blank
`;
    const parsedFolded = parseYaml(foldedYaml) as { folded: string };
    expect(parsedFolded.folded).toContain("line one line two\n\nline three after blank");

    // Block scalar with strip chomping |-
    const stripYaml = `
stripped: |-
  text without trailing newline
`;
    const parsedStrip = parseYaml(stripYaml) as { stripped: string };
    expect(parsedStrip.stripped).toBe("text without trailing newline");
  });
});
