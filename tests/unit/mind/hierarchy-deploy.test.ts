import { describe, expect, test } from "bun:test";
import { AGENT_ROLES, type AgentRole } from "../../../olt/scripts/src/core/contracts/packets.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  ABSTRACT_PROFILES,
  assertAbstractProfile,
  assertNoModelTelemetry,
  assertTierSpawn,
  buildTier1DeploymentPacket,
  createTier1DeployInputFromCandidate,
  loadMindContract,
  validateAbstractProfile,
  validateTierSpawn,
  type Tier1DeploymentPacketInput,
} from "../../../olt/scripts/src/mind/deploy.ts";
import {
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  type MindBudget,
  type ParsedCharter,
} from "../../../olt/scripts/src/mind/charter.ts";
import type { CandidateRecord } from "../../../olt/scripts/src/mind/gates.ts";

describe("Phase 4 W4.3: Strict Tier Hierarchy and Deployment", () => {
  describe("1. Strict tier spawn rules and hierarchy constraints", () => {
    test("mind (tier 0) can deploy ONLY tier 1 orchestrator", () => {
      const valid = validateTierSpawn("mind", "orchestrator");
      expect(valid.ok).toBe(true);
      expect(valid.parentRole).toBe("mind");
      expect(valid.childRole).toBe("orchestrator");
      expect(valid.parentTier).toBe(0);
      expect(valid.childTier).toBe(1);

      expect(() => assertTierSpawn("mind", "orchestrator")).not.toThrow();
    });

    test("mind (tier 0) CANNOT deploy implementer, validator, coordinator, planner, repairer, etc.", () => {
      const prohibited: AgentRole[] = [
        "implementer",
        "validator",
        "coordinator",
        "planner",
        "plan-validator",
        "repairer",
        "completeness-critic",
        "sub-implementer",
        "sub-validator",
        "sub-investigator",
      ];

      for (const role of prohibited) {
        const result = validateTierSpawn("mind", role);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("tier 0 mind may only deploy tier 1 orchestrator");
        expect(() => assertTierSpawn("mind", role)).toThrow(HarnessError);
      }
    });

    test("orchestrator (tier 1) can deploy ONLY tier 2 coordinator", () => {
      const valid = validateTierSpawn("orchestrator", "coordinator");
      expect(valid.ok).toBe(true);
      expect(valid.parentRole).toBe("orchestrator");
      expect(valid.childRole).toBe("coordinator");
      expect(valid.parentTier).toBe(1);
      expect(valid.childTier).toBe(2);

      expect(() => assertTierSpawn("orchestrator", "coordinator")).not.toThrow();
    });

    test("orchestrator (tier 1) CANNOT deploy implementer, validator, mind, planner, etc.", () => {
      const prohibited: AgentRole[] = [
        "implementer",
        "validator",
        "planner",
        "plan-validator",
        "repairer",
        "completeness-critic",
        "sub-implementer",
        "sub-validator",
        "sub-investigator",
      ];

      for (const role of prohibited) {
        const result = validateTierSpawn("orchestrator", role);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("tier 1 orchestrator may only deploy tier 2 coordinator");
        expect(() => assertTierSpawn("orchestrator", role)).toThrow(HarnessError);
      }

      // Prohibited from deploying higher tier (mind)
      const mindResult = validateTierSpawn("orchestrator", "mind");
      expect(mindResult.ok).toBe(false);
      expect(() => assertTierSpawn("orchestrator", "mind")).toThrow(HarnessError);
    });

    test("coordinator (tier 2) can deploy tier 3 execution roles", () => {
      const allowed: AgentRole[] = [
        "implementer",
        "validator",
        "planner",
        "plan-validator",
        "repairer",
        "completeness-critic",
      ];

      for (const role of allowed) {
        const result = validateTierSpawn("coordinator", role);
        expect(result.ok).toBe(true);
        expect(() => assertTierSpawn("coordinator", role)).not.toThrow();
      }
    });

    test("coordinator (tier 2) CANNOT deploy higher tier roles (mind, orchestrator)", () => {
      for (const role of ["mind", "orchestrator"] as const) {
        const result = validateTierSpawn("coordinator", role);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("tier 2 coordinator cannot deploy higher-tier role");
        expect(() => assertTierSpawn("coordinator", role)).toThrow(HarnessError);
      }
    });

    test("implementer (tier 3) can deploy sub-implementer and sub-investigator only", () => {
      expect(validateTierSpawn("implementer", "sub-implementer").ok).toBe(true);
      expect(validateTierSpawn("implementer", "sub-investigator").ok).toBe(true);
      expect(validateTierSpawn("implementer", "sub-validator").ok).toBe(false);
      expect(validateTierSpawn("implementer", "validator").ok).toBe(false);
      expect(validateTierSpawn("implementer", "coordinator").ok).toBe(false);
      expect(validateTierSpawn("implementer", "mind").ok).toBe(false);
    });

    test("validator (tier 3) can deploy sub-validator only", () => {
      expect(validateTierSpawn("validator", "sub-validator").ok).toBe(true);
      expect(validateTierSpawn("validator", "sub-implementer").ok).toBe(false);
      expect(validateTierSpawn("validator", "sub-investigator").ok).toBe(false);
      expect(validateTierSpawn("validator", "implementer").ok).toBe(false);
      expect(validateTierSpawn("validator", "coordinator").ok).toBe(false);
    });

    test("leaf roles cannot deploy any agent role", () => {
      const leafRoles: AgentRole[] = [
        "sub-implementer",
        "sub-validator",
        "sub-investigator",
        "planner",
        "plan-validator",
        "repairer",
        "completeness-critic",
      ];

      for (const parent of leafRoles) {
        for (const child of AGENT_ROLES) {
          const result = validateTierSpawn(parent, child);
          expect(result.ok).toBe(false);
          expect(() => assertTierSpawn(parent, child)).toThrow(HarnessError);
        }
      }
    });

    test("roles cannot deploy themselves", () => {
      for (const role of AGENT_ROLES) {
        const result = validateTierSpawn(role, role);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("cannot deploy itself");
        expect(() => assertTierSpawn(role, role)).toThrow(HarnessError);
      }
    });

    test("unknown agent roles are rejected", () => {
      const result = validateTierSpawn("mind", "non-existent-role" as AgentRole);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("unrecognized agent role");
    });
  });

  describe("2. Mind role contract upgrade", () => {
    test("mind role contract declares tier 0 and spawns: [orchestrator]", () => {
      const mindContract = loadMindContract();
      expect(mindContract.role).toBe("mind");
      expect(mindContract.tier).toBe(0);
      expect(mindContract.spawns).toEqual(["orchestrator"]);
      expect(mindContract.may.length).toBeGreaterThan(0);
      expect(mindContract.must_not.length).toBeGreaterThan(0);
      expect(mindContract.commands.length).toBeGreaterThan(0);
    });

    test("mind contract explicitly grants orchestrator deployment and bounds", () => {
      const mindContract = loadMindContract();
      const mayText = mindContract.may.join("\n");
      expect(mayText).toContain("Deploy tier 1 orchestrators");
      expect(mayText).toContain("govern its execution round parameters");
    });

    test("mind contract explicitly prohibits deploying below tier 1 and writing repository files", () => {
      const mindContract = loadMindContract();
      const mustNotText = mindContract.must_not.join("\n");
      expect(mustNotText).toContain("Deploy any role below tier 1");
      expect(mustNotText).toContain(
        "Write, edit, stage, revert, format or delete any repository file",
      );
      expect(mustNotText).toContain("Claim, implement, repair, validate or review any task");
    });

    test("mind contract includes all necessary deployment and observation commands", () => {
      const mindContract = loadMindContract();
      const commandSet = new Set(mindContract.commands);
      const expectedCommands = [
        "mind:observe",
        "mind:pulse",
        "mind:candidate",
        "mind:admit",
        "mind:quiesce",
        "mind:escalate",
        "mind:halt",
        "doctor",
        "agent:list",
        "agent:register",
        "agent:release",
      ];
      for (const cmd of expectedCommands) {
        expect(commandSet.has(cmd)).toBe(true);
      }
    });
  });

  describe("3. Abstract profile validation and 0 model telemetry enforcement", () => {
    test("valid abstract profiles are accepted", () => {
      for (const profile of ABSTRACT_PROFILES) {
        expect(validateAbstractProfile(profile).ok).toBe(true);
        expect(() => assertAbstractProfile(profile)).not.toThrow();
      }
      expect(validateAbstractProfile("custom_abstract_profile").ok).toBe(true);
    });

    test("concrete model names are strictly rejected as profiles", () => {
      const concreteModels = [
        "claude-3-5-sonnet-20241022",
        "claude-sonnet-4-5",
        "gpt-4o",
        "gpt-4.5-turbo",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "gemini-flash",
        "claude-opus-3",
        "haiku",
        "llama-3.3-70b",
        "deepseek-r1",
        "qwen-2.5-coder",
        "mistral-large",
        "o1-preview",
        "o3-mini",
        "pro",
      ];

      for (const model of concreteModels) {
        const result = validateAbstractProfile(model);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("concrete model identifier");
        expect(() => assertAbstractProfile(model)).toThrow(HarnessError);
      }
    });

    test("assertNoModelTelemetry catches concrete model names and telemetry keys", () => {
      const cleanData = {
        objective: "Fix defect in scheduler",
        profile: "deliberate",
        budget: 3,
      };
      expect(() => assertNoModelTelemetry(cleanData)).not.toThrow();

      expect(() => assertNoModelTelemetry({ ...cleanData, model: "some-model" })).toThrow(
        HarnessError,
      );

      expect(() => assertNoModelTelemetry({ ...cleanData, model_tier: "m" })).toThrow(HarnessError);

      expect(() => assertNoModelTelemetry({ ...cleanData, thinking_level: "high" })).toThrow(
        HarnessError,
      );

      expect(() =>
        assertNoModelTelemetry({ ...cleanData, nested: { prompt: "use claude-3-5-sonnet" } }),
      ).toThrow(HarnessError);
    });
  });

  describe("4. Tier 1 deployment packet generation and evidence spine", () => {
    const validPacketInput: Tier1DeploymentPacketInput = {
      runId: "mind-run-001",
      agentId: "orch-01",
      candidateStatement: "Repair boundary lease recovery timeout calculation",
      witnessCommandId: "cmd-witness-42",
      charterGoalIds: ["G1", "G3"],
      remainingRoundBudget: 3,
      remainingWallClockBudgetMs: 14_400_000,
      profile: "deliberate",
      prohibitions: DEFAULT_PROHIBITIONS,
    };

    test("builds complete Tier 1 packet with correct evidence classes", () => {
      const packet = buildTier1DeploymentPacket(validPacketInput);

      expect(packet.schema).toBe("harness.tier1-deployment-packet");
      expect(packet.version).toBe(1);
      expect(packet.role).toBe("orchestrator");
      expect(packet.agent_id).toBe("orch-01");
      expect(packet.run_id).toBe("mind-run-001");

      // Check evidence classes
      expect(packet.objective.evidence_class).toBe("agent_reported");
      expect(packet.objective.value).toBe("Repair boundary lease recovery timeout calculation");

      expect(packet.witness_command_id.evidence_class).toBe("harness_observed");
      expect(packet.witness_command_id.value).toBe("cmd-witness-42");

      expect(packet.charter_goal_ids.evidence_class).toBe("harness_observed");
      expect(packet.charter_goal_ids.value).toEqual(["G1", "G3"]);

      expect(packet.round_budget.evidence_class).toBe("derived");
      expect(packet.round_budget.value).toBe(3);

      expect(packet.wall_clock_budget.evidence_class).toBe("derived");
      expect(packet.wall_clock_budget.value).toBe(14_400_000);

      expect(packet.profile.evidence_class).toBe("agent_reported");
      expect(packet.profile.value).toBe("deliberate");

      expect(packet.prohibitions.evidence_class).toBe("harness_observed");
      expect(packet.prohibitions.value).toBe(DEFAULT_PROHIBITIONS);

      expect(packet.packet_sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(packet.markdown).toContain("# Tier 1 Deployment Packet — Orchestrator (orch-01)");
      expect(packet.markdown).toContain("Repair boundary lease recovery timeout calculation");
      expect(packet.markdown).toContain("`cmd-witness-42`");
      expect(packet.markdown).toContain("- `G1`");
      expect(packet.markdown).toContain("- `G3`");
      expect(packet.markdown).toContain("**Round budget**: 3");
      expect(packet.markdown).toContain("`deliberate`");
    });

    test("packet contains strictly 0 model names, model tiers, or thinking levels", () => {
      const packet = buildTier1DeploymentPacket(validPacketInput);
      const serialized = JSON.stringify(packet);

      expect(serialized).not.toContain('"model"');
      expect(serialized).not.toContain('"model_tier"');
      expect(serialized).not.toContain('"thinking_level"');
      expect(packet.profile.value).toBe("deliberate");
      expect(validateAbstractProfile(packet.profile.value).ok).toBe(true);
    });

    test("rejects invalid inputs when constructing packet", () => {
      expect(() =>
        buildTier1DeploymentPacket({ ...validPacketInput, candidateStatement: "" }),
      ).toThrow(HarnessError);

      expect(() =>
        buildTier1DeploymentPacket({ ...validPacketInput, witnessCommandId: "" }),
      ).toThrow(HarnessError);

      expect(() => buildTier1DeploymentPacket({ ...validPacketInput, charterGoalIds: [] })).toThrow(
        HarnessError,
      );

      expect(() =>
        buildTier1DeploymentPacket({ ...validPacketInput, remainingRoundBudget: 0 }),
      ).toThrow(HarnessError);

      expect(() =>
        buildTier1DeploymentPacket({ ...validPacketInput, remainingWallClockBudgetMs: -1 }),
      ).toThrow(HarnessError);

      expect(() =>
        buildTier1DeploymentPacket({ ...validPacketInput, profile: "claude-3-opus" }),
      ).toThrow(HarnessError);
    });
  });

  describe("5. Candidate to Tier 1 deployment helper", () => {
    const mockCandidate: CandidateRecord = {
      id: "cand-01",
      kind: "defect",
      statement: "Fix watchdog leak on abort",
      witness_command_id: "cmd-witness-99",
      charter_goal_ids: ["G1", "G2"],
      write_scope: ["src/watchdog.ts"],
      status: "admitted",
    };

    const mockCharter: ParsedCharter = {
      identity: "Mind",
      goals: [
        { id: "G1", statement: "Goal 1" },
        { id: "G2", statement: "Goal 2" },
      ],
      goalIds: ["G1", "G2"],
      nonGoals: [],
      repoRoots: ["src/"],
      prohibitions: DEFAULT_PROHIBITIONS,
      rawText: "Charter text",
      sha256: "deadbeef",
    };

    const mockBudget: MindBudget = {
      ...DEFAULT_MIND_BUDGET,
      day_key: "2026-08-21",
      pulses_today: 5,
      wall_clock_ms_today: 1_200_000,
    };

    test("creates deployment input from admitted candidate", () => {
      const input = createTier1DeployInputFromCandidate(
        mockCandidate,
        mockCharter,
        mockBudget,
        "mind-run-002",
        "orch-02",
      );

      expect(input.runId).toBe("mind-run-002");
      expect(input.agentId).toBe("orch-02");
      expect(input.candidateStatement).toBe("Fix watchdog leak on abort");
      expect(input.witnessCommandId).toBe("cmd-witness-99");
      expect(input.charterGoalIds).toEqual(["G1", "G2"]);
      expect(input.remainingRoundBudget).toBeGreaterThanOrEqual(1);
      expect(input.remainingWallClockBudgetMs).toBeGreaterThanOrEqual(60_000);
      expect(input.profile).toBe("deliberate");
    });

    test("refuses unadmitted candidate", () => {
      const unadmitted: CandidateRecord = {
        ...mockCandidate,
        status: "opened",
      };

      expect(() =>
        createTier1DeployInputFromCandidate(
          unadmitted,
          mockCharter,
          mockBudget,
          "mind-run-002",
          "orch-02",
        ),
      ).toThrow(HarnessError);
    });

    test("refuses candidate without witness command id", () => {
      const noWitness: CandidateRecord = {
        ...mockCandidate,
        witness_command_id: undefined,
      };

      expect(() =>
        createTier1DeployInputFromCandidate(
          noWitness,
          mockCharter,
          mockBudget,
          "mind-run-002",
          "orch-02",
        ),
      ).toThrow(HarnessError);
    });
  });
});
