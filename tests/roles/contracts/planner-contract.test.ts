import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  loadAgentManifest,
  loadUnifiedAgentModel,
} from "../../../olt/scripts/src/authority/manifest/index.ts";
import { loadRoleContract as loadPacketRoleContract } from "../../../olt/scripts/src/packets/role-contract.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualRolesFS, getVirtualRolesFS, setupVirtualRolesFS } from "../fixture.ts";

describe("Planner & Plan-Validator Role Contracts & Agent Manifests Sync", () => {
  beforeEach(() => {
    setupVirtualRolesFS();
  });

  afterEach(() => {
    cleanupVirtualRolesFS();
  });

  const repoRoot = process.cwd();
  const plannerRolePath = join(repoRoot, "olt/agents/planner.yaml");
  const planValidatorRolePath = join(repoRoot, "olt/agents/plan-validator.yaml");
  const plannerAgentPath = join(repoRoot, "olt/agents/planner.yaml");
  const planValidatorAgentPath = join(repoRoot, "olt/agents/plan-validator.yaml");

  test("all target contract and manifest files exist on disk", () => {
    const vfs = getVirtualRolesFS();
    expect(vfs.existsSync(plannerRolePath)).toBe(true);
    expect(vfs.existsSync(planValidatorRolePath)).toBe(true);
  });

  describe("Planner Role Contract (olt/roles/planner.md)", () => {
    test("parses successfully via loadRoleContract and conforms to RoleContract schema", () => {
      const contract = loadPacketRoleContract("planner");
      expect(contract.role).toBe("planner");
      expect(contract.tier).toBe(3);
      expect(contract.spawns).toEqual([]);
      expect(contract.commands).toContain("plan:brainstorm");
      expect(contract.commands).toContain("plan:compile");
      expect(contract.commands).toContain("plan:add");
      expect(contract.commands).toContain("plan:enhance");
      expect(contract.commands).toContain("plan:claim");
      expect(contract.commands).toContain("plan:apply");
      expect(contract.commands).toContain("plan:status");
      expect(contract.commands).toContain("plan:replan");
    });

    test("contains all mandatory keywords and invariants", () => {
      const vfs = getVirtualRolesFS();
      const raw = vfs.readFileSync(plannerRolePath, "utf-8");
      expect(raw).toContain("plan:brainstorm");
      expect(raw).toContain("8-Vector");
      expect(raw).toContain("EMPTY_PAYLOAD");
      expect(raw).toContain("TIMEOUT_STAGNATION");
      expect(raw).toContain("CONCURRENCY_MUTATION");
      expect(raw).toContain("HOST_BOUNDARY");
      expect(raw).toContain("STATE_TRANSITION");
      expect(raw).toContain("TYPE_INVARIANT");
      expect(raw).toContain("CLI_TELEMETRY");
      expect(raw).toContain("ADVERSARIAL_GATE");
      expect(raw).toContain("socratic_expansion_depth");
      expect(raw).toContain("mandatory_brainstorming_rounds");
    });

    test("mandates plan:brainstorm before plan:compile in may and must_not clauses", () => {
      const contract = loadPacketRoleContract("planner");
      const mayText = contract.may.join(" ");
      const mustNotText = contract.must_not.join(" ");

      expect(mayText).toContain("plan:brainstorm");
      expect(mayText).toContain("8-Vector Expansion Matrix");
      expect(mustNotText).toContain("plan:brainstorm");
      expect(mustNotText).toContain("EMPTY_PAYLOAD");
      expect(mustNotText).toContain("socratic_expansion_depth");
      expect(mustNotText).toContain("mandatory_brainstorming_rounds");
    });
  });

  describe("Plan-Validator Role Contract (olt/roles/plan-validator.md)", () => {
    test("parses successfully via loadRoleContract and conforms to RoleContract schema", () => {
      const contract = loadPacketRoleContract("plan-validator");
      expect(contract.role).toBe("plan-validator");
      expect(contract.tier).toBe(3);
      expect(contract.spawns).toEqual([]);
      expect(contract.commands).toContain("plan:validate-start");
      expect(contract.commands).toContain("plan:review");
      expect(contract.commands).toContain("run:exec");
      expect(contract.commands).toContain("summary:view");
    });

    test("contains all mandatory keywords and SHALLOW_PLAN_BLUNDER invariants", () => {
      const vfs = getVirtualRolesFS();
      const raw = vfs.readFileSync(planValidatorRolePath, "utf-8");
      expect(raw).toContain("SHALLOW_PLAN_BLUNDER");
      expect(raw).toContain("8-vector");
      expect(raw).toContain("EMPTY_PAYLOAD");
      expect(raw).toContain("socratic_expansion_depth");
      expect(raw).toContain("mandatory_brainstorming_rounds");
      expect(raw).toContain("plan:brainstorm");
    });

    test("enforces adversarial rejection of shallow umbrella compression in must_not clauses", () => {
      const contract = loadPacketRoleContract("plan-validator");
      const mustNotText = contract.must_not.join(" ");

      expect(mustNotText).toContain("SHALLOW_PLAN_BLUNDER");
      expect(mustNotText).toContain("shallow umbrella compression");
      expect(mustNotText).toContain("max_files_per_task");
    });
  });

  describe("Planner Agent Manifest (olt/agents/planner.yaml)", () => {
    test("parses cleanly as AgentManifest and contains required invariants", () => {
      const manifest = loadAgentManifest("planner");
      expect(manifest.name).toBe("planner");
      expect(manifest.role).toBe("planner");
      expect(manifest.tier).toBe(3);
      expect(manifest.tools?.enable_subagent_tools).toBe(false);
      expect(manifest.tools?.enable_write_tools).toBe(true);

      expect(manifest.invariants).toBeDefined();
      expect(manifest.invariants).toContain("EIGHT_VECTOR_SOCRATIC_EXPANSION");
      expect(manifest.invariants).toContain("PROMPT_LINE_COORDINATE_BINDING");
      expect(manifest.invariants).toContain("DISJOINT_WRITE_SCOPE_DECOMPOSITION");
      expect(manifest.invariants).toContain("DIRECTED_ACYCLIC_GRAPH_INTEGRITY");
    });

    test("instructions contain 8-vector matrix and plan:brainstorm mandates", () => {
      const vfs = getVirtualRolesFS();
      const raw = vfs.readFileSync(plannerAgentPath, "utf-8");
      expect(raw).toContain("plan:brainstorm");
      expect(raw).toContain("8-Vector");
      expect(raw).toContain("EMPTY_PAYLOAD");
      expect(raw).toContain("TIMEOUT_STAGNATION");
      expect(raw).toContain("CONCURRENCY_MUTATION");
      expect(raw).toContain("HOST_BOUNDARY");
      expect(raw).toContain("STATE_TRANSITION");
      expect(raw).toContain("TYPE_INVARIANT");
      expect(raw).toContain("CLI_TELEMETRY");
      expect(raw).toContain("ADVERSARIAL_GATE");
      expect(raw).toContain("socratic_expansion_depth");
      expect(raw).toContain("mandatory_brainstorming_rounds");
    });
  });

  describe("Plan-Validator Agent Manifest (olt/agents/plan-validator.yaml)", () => {
    test("parses cleanly as AgentManifest and contains required invariants", () => {
      const manifest = loadAgentManifest("plan-validator");
      expect(manifest.name).toBe("plan-validator");
      expect(manifest.role).toBe("plan-validator");
      expect(manifest.tier).toBe(3);
      expect(manifest.tools?.enable_subagent_tools).toBe(false);
      expect(manifest.tools?.enable_write_tools).toBe(true);

      expect(manifest.invariants).toBeDefined();
      expect(manifest.invariants).toContain("SHALLOW_PLAN_BLUNDER_REJECTION");
      expect(manifest.invariants).toContain("EIGHT_VECTOR_EXPANSION_VERIFICATION");
      expect(manifest.invariants).toContain("DISJOINT_WRITE_SCOPE_AUDIT");
      expect(manifest.invariants).toContain("ADVERSARIAL_GATE_DISCRIMINATION");
    });

    test("instructions mandate rejection of SHALLOW_PLAN_BLUNDER and verify 8-vector expansion", () => {
      const vfs = getVirtualRolesFS();
      const raw = vfs.readFileSync(planValidatorAgentPath, "utf-8");
      expect(raw).toContain("SHALLOW_PLAN_BLUNDER");
      expect(raw).toContain("8-Vector");
      expect(raw).toContain("EMPTY_PAYLOAD");
      expect(raw).toContain("socratic_expansion_depth");
      expect(raw).toContain("mandatory_brainstorming_rounds");
      expect(raw).toContain("plan:brainstorm");
    });
  });

  describe("Unified Agent Model Resolution", () => {
    test("loads unified agent model for planner and plan-validator", () => {
      const plannerModel = loadUnifiedAgentModel("planner");
      expect(plannerModel.role).toBe("planner");
      expect(plannerModel.tier).toBe(3);
      expect(plannerModel.commands).toContain("plan:brainstorm");
      expect(plannerModel.commands).toContain("plan:compile");

      const validatorModel = loadUnifiedAgentModel("plan-validator");
      expect(validatorModel.role).toBe("plan-validator");
      expect(validatorModel.tier).toBe(3);
      expect(validatorModel.commands).toContain("plan:validate-start");
      expect(validatorModel.commands).toContain("plan:review");
    });
  });

  describe("Role Contract Integrity & Edge Cases", () => {
    test("rejects mismatched role name (role spoofing) with HarnessError INTEGRITY", () => {
      const vfs = getVirtualRolesFS();
      const spoofedYaml = [
        "name: planner",
        "role: worker",
        "tier: 3",
        "provider: [anthropic]",
        "tools:",
        "  enable_subagent_tools: true",
        "  enable_write_tools: true",
        "interface:",
        "  display_name: Planner",
        "  short_description: Creates plans",
      ].join("\n");
      vfs.writeFileSync(plannerRolePath, spoofedYaml);

      expect(() => loadPacketRoleContract("planner")).toThrow(HarnessError);
      try {
        loadPacketRoleContract("planner");
        expect.unreachable("should have thrown HarnessError");
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    });

    test("rejects malformed unparseable YAML contract with clean HarnessError INTEGRITY", () => {
      const vfs = getVirtualRolesFS();
      const corruptedYaml = `
name: planner: [broken
  bad_indent: {{{
      `;
      vfs.writeFileSync(plannerRolePath, corruptedYaml);

      expect(() => loadPacketRoleContract("planner")).toThrow(HarnessError);
      try {
        loadPacketRoleContract("planner");
        expect.unreachable("should have thrown HarnessError");
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("INTEGRITY");
      }
    });
  });
});
