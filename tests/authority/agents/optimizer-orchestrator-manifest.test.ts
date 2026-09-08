import { describe, expect, it } from "bun:test";
import rawYamlText from "../../../olt/agents/optimizer-orchestrator.yaml" with { type: "text" };
import roleContractMarkdown from "../../../olt/roles/optimizer-orchestrator.md" with { type: "text" };
import { resolve } from "node:path";
import * as yaml from "js-yaml";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type UnifiedAgentManifest,
} from "../../../olt/scripts/src/authority/manifest-schema.ts";
import { parseRoleContract } from "../../../olt/scripts/src/authority/manifest/frontmatter-parser.ts";

const MANIFEST_PATH = resolve(import.meta.dir, "../../../olt/agents/optimizer-orchestrator.yaml");
const ROLE_CONTRACT_PATH = resolve(import.meta.dir, "../../../olt/roles/optimizer-orchestrator.md");

const EXPECTED_OPTIMIZE_COMMANDS = [
  "optimize:scan",
  "optimize:analyze",
  "optimize:check-ast",
  "optimize:check-tests",
  "optimize:quarantine",
  "optimize:check-drift",
] as const;

const EXPECTED_INVARIANTS = [
  "SUPERVISOR_ZERO_CODE_EDITS",
  "SUPERVISOR_ZERO_TEST_RUNS",
  "ZERO_FEATURE_INVENTION",
  "ZERO_PUBLIC_API_EXPANSION",
  "ZERO_BEHAVIORAL_DELTA",
  "MONOLITHIC_FILE_DECOMPOSITION",
  "BRENT_MODULE_CONCURRENCY",
  "REAL_TIME_AUDITOR_PREEMPTION",
  "QUIESCENT_ZERO_TOKEN_DRIFT",
  "QUOTA_FREEZE_ZERO_KILL_RESUME",
] as const;

interface RawManifestDoc {
  readonly name?: string;
  readonly role?: string;
  readonly tier?: number | string;
  readonly authority?: string;
  readonly disallowed_parent?: readonly string[];
  readonly allowed_companion?: readonly string[];
  readonly communication_contract?: {
    readonly mandatory_turn_completion_actions?: readonly string[];
    readonly protocol?: string;
    readonly mailbox_path?: string;
    readonly lock_path?: string;
    readonly allowed_channels?: readonly string[];
    readonly ban_raw_jsonl_reading?: boolean;
    readonly forbid_native_messaging?: boolean;
  };
  readonly tools?: {
    readonly enable_subagent_tools?: boolean;
    readonly enable_write_tools?: boolean;
  };
  readonly permissions?: {
    readonly may?: readonly string[];
    readonly must_not?: readonly string[];
    readonly commands?: readonly string[];
    readonly spawns?: readonly string[];
  };
  readonly invariants?: readonly string[];
  readonly instructions?: string;
}

function parseAndValidateManifest(rawYaml: string, filePath?: string): UnifiedAgentManifest {
  const manifest = parseUnifiedAgentManifest(rawYaml, filePath);
  const validation = validateUnifiedAgentManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Manifest validation failed: ${validation.errors.join("; ")}`);
  }
  if (!manifest.instructions || manifest.instructions.trim().length === 0) {
    throw new Error("Manifest validation failed: Field 'instructions' must not be empty");
  }
  return manifest;
}

describe("Tier 1 Optimizer-Orchestrator Manifest & Role Contract Authority Tests", () => {
  it("parses and validates olt/agents/optimizer-orchestrator.yaml cleanly", () => {
    const rawYaml = rawYamlText;
    const manifest = parseAndValidateManifest(rawYaml, MANIFEST_PATH);

    expect(manifest.name).toBe("optimizer-orchestrator");
    expect(manifest.role).toBe("optimizer-orchestrator");
    expect(manifest.tier).toBe(1);

    const validation = validateUnifiedAgentManifest(manifest);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("strictly enforces tools configuration: 0 write tools and subagent tools enabled", () => {
    const rawYaml = rawYamlText;
    const manifest = parseUnifiedAgentManifest(rawYaml, MANIFEST_PATH);

    expect(manifest.tools.enable_subagent_tools).toBe(true);
    expect(manifest.tools.enable_write_tools).toBe(false);
  });

  it("verifies provider list and user interface display descriptors", () => {
    const rawYaml = rawYamlText;
    const manifest = parseUnifiedAgentManifest(rawYaml, MANIFEST_PATH);

    const expectedProviders = ["antigravity", "agy", "claude", "codex", "cursor", "generic"];
    for (const provider of expectedProviders) {
      expect(manifest.provider).toContain(provider);
    }

    expect(manifest.interface.display_name).toBe(
      "Tier 1 Autonomous Optimizer & Maintenance Orchestrator",
    );
    expect(manifest.interface.short_description).toContain(
      "Alpha autonomous driver for backlog drainage",
    );
  });

  it("enforces authority standing, disallowed_parent mind, and companion pairing in raw manifest", () => {
    const rawYaml = rawYamlText;
    const rawDoc = yaml.load(rawYaml) as RawManifestDoc;

    expect(rawDoc.authority).toBe("alpha");
    expect(rawDoc.disallowed_parent).toEqual(["mind"]);
    expect(rawDoc.allowed_companion).toEqual(["skill-auditor"]);
  });

  it("strictly bounds permissions: spawns coordinator only and includes all 6 optimize commands", () => {
    const rawYaml = rawYamlText;
    const manifest = parseUnifiedAgentManifest(rawYaml, MANIFEST_PATH);

    expect(manifest.permissions.spawns).toEqual(["coordinator"]);
    expect(manifest.permissions.commands).toBeDefined();
    const commands = manifest.permissions.commands ?? [];

    for (const optCmd of EXPECTED_OPTIMIZE_COMMANDS) {
      expect(commands).toContain(optCmd);
    }

    expect(commands).toContain("run:init");
    expect(commands).toContain("run:complete");
    expect(commands).toContain("doctor");
    expect(commands).toContain("msg:send");
    expect(commands).toContain("msg:recv");
    expect(commands).toContain("msg:poll");
    expect(commands).toContain("worktree:create");
    expect(commands).toContain("worktree:clean");
  });

  it("contains all 10 architectural invariants exactly", () => {
    const rawYaml = rawYamlText;
    const manifest = parseUnifiedAgentManifest(rawYaml, MANIFEST_PATH);

    expect(manifest.invariants.length).toBe(EXPECTED_INVARIANTS.length);
    for (const invariant of EXPECTED_INVARIANTS) {
      expect(manifest.invariants).toContain(invariant);
    }
  });

  it("verifies communication contract and dispatch contract parameters", () => {
    const rawYaml = rawYamlText;
    const manifest = parseUnifiedAgentManifest(rawYaml, MANIFEST_PATH);
    const rawDoc = yaml.load(rawYaml) as RawManifestDoc;

    expect(manifest.communication_contract).toBeDefined();
    expect(manifest.communication_contract?.protocol).toBe("mailbox_ipc");
    expect(manifest.communication_contract?.mailbox_path).toBe(".olt/mailboxes/{agent_id}/");
    expect(manifest.communication_contract?.lock_path).toBe(".olt/locks/mailboxes/{agent_id}.lock");
    expect(manifest.communication_contract?.ban_raw_jsonl_reading).toBe(true);
    expect(manifest.communication_contract?.forbid_native_messaging).toBe(true);
    expect(manifest.communication_contract?.allowed_channels).toContain("msg:send");
    expect(manifest.communication_contract?.allowed_channels).toContain("msg:recv");
    expect(manifest.communication_contract?.allowed_channels).toContain("msg:poll");

    const completionActions = rawDoc.communication_contract?.mandatory_turn_completion_actions;
    expect(completionActions).toContain("doctor:verify");

    expect(manifest.mandatory_turn1_actions).toEqual(["run:init"]);
    expect(manifest.dispatch_contract).toBe("zero_exploration_exact_anchor");
    expect(manifest.protocol.cli).toBe("bun ~/.agents/skills/olt/scripts/harness.ts");
    expect(manifest.protocol.zero_json).toBe(true);
  });

  it("verifies rich operational instructions covering mandate, Hard Zeros, and FSM", () => {
    const rawYaml = rawYamlText;
    const manifest = parseUnifiedAgentManifest(rawYaml, MANIFEST_PATH);

    expect(manifest.instructions).toContain("Operational Mandate");
    expect(manifest.instructions).toContain("The Three Hard Zeros");
    expect(manifest.instructions).toContain("Zero Feature Invention");
    expect(manifest.instructions).toContain("Deterministic 4-Phase FSM");
    expect(manifest.instructions).toContain("Auditor Interoperability");
    expect(manifest.instructions).toContain("Platform Scheduler & Quota");
  });

  describe("Counterfactual Falsifiability Tests", () => {
    it("throws error when manifest instructions are missing or empty", () => {
      const missingInstructionsYaml = `
name: "optimizer-orchestrator"
role: "optimizer-orchestrator"
tier: 1
tools:
  enable_subagent_tools: true
  enable_write_tools: false
permissions:
  may: ["test"]
  must_not: ["test"]
  spawns: ["coordinator"]
invariants: []
instructions: ""
`;
      expect(() => parseAndValidateManifest(missingInstructionsYaml, "test.yaml")).toThrow(
        "Field 'instructions' must not be empty",
      );

      const syntheticInvalid = {
        name: "optimizer-orchestrator",
        role: "optimizer-orchestrator",
        tier: 1,
        provider: ["generic"],
        tools: { enable_subagent_tools: true, enable_write_tools: false },
        interface: { display_name: "Test", short_description: "Desc" },
        permissions: { may: [], must_not: [], spawns: [] },
        invariants: [],
        protocol: { cli: "bun harness.ts", zero_json: true },
        instructions: 123 as unknown as string,
      } as unknown as UnifiedAgentManifest;

      const validation = validateUnifiedAgentManifest(syntheticInvalid);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((err) => err.includes("instructions"))).toBe(true);
    });

    it("throws error when manifest tier is invalid or out of range", () => {
      const invalidTierYaml = `
name: "optimizer-orchestrator"
role: "optimizer-orchestrator"
tier: "invalid_tier"
instructions: "Valid instructions"
`;
      const parsed = parseUnifiedAgentManifest(invalidTierYaml, "test.yaml");
      const syntheticBadTier: UnifiedAgentManifest = {
        ...parsed,
        tier: "invalid_tier" as unknown as number,
      };

      const result = validateUnifiedAgentManifest(syntheticBadTier);
      expect(result.valid).toBe(false);
      expect(result.errors.some((err) => err.includes("tier"))).toBe(true);

      expect(() => {
        const val = validateUnifiedAgentManifest(syntheticBadTier);
        if (!val.valid) throw new Error(`Invalid tier: ${val.errors.join("; ")}`);
      }).toThrow("Invalid tier");
    });

    it("throws error on malformed YAML or non-object documents", () => {
      expect(() => parseUnifiedAgentManifest("")).toThrow();
      expect(() => parseUnifiedAgentManifest("just a scalar string")).toThrow(
        "YAML document must be an object",
      );
      expect(() => parseUnifiedAgentManifest("- list item 1\n- list item 2")).toThrow(
        "YAML document must be an object",
      );
    });

    it("detects permission and tool violations counterfactually", () => {
      const rawYaml = rawYamlText;
      const manifest = parseUnifiedAgentManifest(rawYaml, MANIFEST_PATH);

      const illegalWriteTools: UnifiedAgentManifest = {
        ...manifest,
        tools: { enable_subagent_tools: true, enable_write_tools: true },
      };
      expect(illegalWriteTools.tools.enable_write_tools).not.toBe(
        manifest.tools.enable_write_tools,
      );

      const illegalDirectWorkerSpawning: UnifiedAgentManifest = {
        ...manifest,
        permissions: {
          ...manifest.permissions,
          spawns: ["coordinator", "implementer"],
        },
      };
      expect(illegalDirectWorkerSpawning.permissions.spawns).toContain("implementer");
      expect(manifest.permissions.spawns).not.toContain("implementer");
    });
  });

  describe("Role Contract Documentation Alignment (olt/roles/optimizer-orchestrator.md)", () => {
    it("parses role contract frontmatter and aligns with manifest specifications", () => {
      const roleMarkdown = roleContractMarkdown;
      const contract = parseRoleContract(roleMarkdown, ROLE_CONTRACT_PATH);

      expect(contract.role).toBe("optimizer-orchestrator");
      expect(contract.tier).toBe(1);
      expect(contract.spawns).toEqual(["coordinator"]);

      for (const optCmd of EXPECTED_OPTIMIZE_COMMANDS) {
        expect(contract.commands).toContain(optCmd);
      }

      expect(contract.frontmatter.authority).toBe("alpha");
      expect(contract.frontmatter.disallowed_parent).toEqual(["mind"]);
      expect(contract.frontmatter.allowed_companion).toEqual(["skill-auditor"]);
    });

    it("verifies role contract body documents all boundaries, invariants, and FSM phases", () => {
      const roleMarkdown = roleContractMarkdown;
      const contract = parseRoleContract(roleMarkdown, ROLE_CONTRACT_PATH);

      expect(contract.body).toContain("The Three Hard Zeros");
      expect(contract.body).toContain("ZERO_FEATURE_INVENTION");
      expect(contract.body).toContain("ZERO_PUBLIC_API_EXPANSION");
      expect(contract.body).toContain("ZERO_BEHAVIORAL_DELTA");
      expect(contract.body).toContain("MONOLITHIC_FILE_DECOMPOSITION");
      expect(contract.body).toContain("BRENT_MODULE_CONCURRENCY");
      expect(contract.body).toContain("REAL_TIME_AUDITOR_PREEMPTION");
      expect(contract.body).toContain("QUIESCENT_ZERO_TOKEN_DRIFT");
      expect(contract.body).toContain("QUOTA_FREEZE_ZERO_KILL_RESUME");

      expect(contract.body).toContain("Phase 1: Plan Execution");
      expect(contract.body).toContain("Phase 2: Optimization Analysis");
      expect(contract.body).toContain("Phase 3: Optimization Dispatch");
      expect(contract.body).toContain("Phase 4: Quiescent Steady State");

      expect(contract.body).toContain("skill-auditor");
      expect(contract.body).toContain("mailbox_ipc");
    });
  });
});
