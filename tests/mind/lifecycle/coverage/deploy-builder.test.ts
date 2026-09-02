import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  DEFAULT_PROHIBITIONS,
  type MindBudget,
  type ParsedCharter,
} from "../../../../olt/scripts/src/mind/lifecycle/charter/index.ts";
import type { CandidateRecord } from "../../../../olt/scripts/src/mind/proposals/gates/index.ts";
import {
  assertNoModelTelemetry,
  resolveOrchestratorContractSha256,
  buildTier1DeploymentPacket,
  createTier1DeployInputFromCandidate,
  type Tier1DeploymentPacketInput,
} from "../../../../olt/scripts/src/mind/lifecycle/deploy/builder.ts";

describe("Tier 1 Deployment Packet Builder Suite (builder.ts)", () => {
  describe("assertNoModelTelemetry", () => {
    it("validates prohibited telemetry keys and model names", () => {
      const prohibitedKeys = [
        "model",
        "model_tier",
        "thinking_level",
        "provider",
        "context_window",
      ];
      for (const key of prohibitedKeys)
        expect(() => assertNoModelTelemetry({ [key]: "val" })).toThrow(HarnessError);

      const badValues = [
        "use claude-3-5-sonnet",
        "gpt-4o execution",
        "gemini-pro",
        "deepseek-reasoner",
        "qwen-2.5-coder",
        "mistral-large",
        "o1-preview",
        "o3-mini",
        "flash model",
      ];
      for (const val of badValues)
        expect(() => assertNoModelTelemetry({ note: val })).toThrow(HarnessError);

      expect(() =>
        assertNoModelTelemetry({ meta: { config: { innerName: "claude-3-opus" } } }),
      ).toThrow(HarnessError);
      expect(() =>
        assertNoModelTelemetry({
          prohibitions: "NEVER agy, claude, zsh",
          markdown: "# Report citing claude",
          validKey: "clean",
        }),
      ).not.toThrow();
      expect(() =>
        assertNoModelTelemetry({ id: "p-1", count: 42, active: true, items: ["a", "b"] }),
      ).not.toThrow();
    });
  });

  describe("resolveOrchestratorContractSha256", () => {
    it("resolves role contract sha256 or falls back to empty string", () => {
      const sha = resolveOrchestratorContractSha256();
      expect(typeof sha).toBe("string");
      if (sha.length > 0) expect(sha).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("buildTier1DeploymentPacket", () => {
    const validBaseInput: Tier1DeploymentPacketInput = {
      runId: "run-gen-100",
      agentId: "orch-lane-1",
      candidateStatement: "Implement automated recovery harness",
      witnessCommandId: "cmd-witness-test-fail-1",
      charterGoalIds: ["G1", "G2"],
      remainingRoundBudget: 3,
      remainingWallClockBudgetMs: 3600000,
    };

    it("validates all required input fields with strict guards", () => {
      expect(() => buildTier1DeploymentPacket({ ...validBaseInput, runId: "  " })).toThrow(
        HarnessError,
      );
      expect(() => buildTier1DeploymentPacket({ ...validBaseInput, agentId: "" })).toThrow(
        HarnessError,
      );
      expect(() =>
        buildTier1DeploymentPacket({ ...validBaseInput, candidateStatement: "" }),
      ).toThrow(HarnessError);
      expect(() => buildTier1DeploymentPacket({ ...validBaseInput, witnessCommandId: "" })).toThrow(
        HarnessError,
      );
      expect(() => buildTier1DeploymentPacket({ ...validBaseInput, charterGoalIds: [] })).toThrow(
        HarnessError,
      );
      expect(() =>
        buildTier1DeploymentPacket({ ...validBaseInput, remainingRoundBudget: 0 }),
      ).toThrow(HarnessError);
      expect(() =>
        buildTier1DeploymentPacket({ ...validBaseInput, remainingRoundBudget: 1.5 }),
      ).toThrow(HarnessError);
      expect(() =>
        buildTier1DeploymentPacket({ ...validBaseInput, remainingWallClockBudgetMs: 0 }),
      ).toThrow(HarnessError);
      expect(() =>
        buildTier1DeploymentPacket({ ...validBaseInput, remainingWallClockBudgetMs: Number.NaN }),
      ).toThrow(HarnessError);
    });

    it("rejects invalid abstract profile names", () => {
      expect(() =>
        buildTier1DeploymentPacket({ ...validBaseInput, profile: "claude-tier" }),
      ).toThrow(HarnessError);
      expect(() => buildTier1DeploymentPacket({ ...validBaseInput, profile: "   " })).toThrow(
        HarnessError,
      );
    });

    it("constructs full Tier 1 deployment packet with evidenced stamps and markdown", () => {
      const packet = buildTier1DeploymentPacket({
        ...validBaseInput,
        profile: "deliberate",
        prohibitions: "Custom strict prohibitions",
        roleContractSha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      });

      expect(packet.schema).toBe("harness.tier1-deployment-packet");
      expect(packet.version).toBe(1);
      expect(packet.role).toBe("orchestrator");
      expect(packet.agent_id).toBe("orch-lane-1");
      expect(packet.run_id).toBe("run-gen-100");
      expect(packet.objective.evidence_class).toBe("agent_reported");
      expect(packet.objective.value).toBe("Implement automated recovery harness");
      expect(packet.witness_command_id.evidence_class).toBe("harness_observed");
      expect(packet.charter_goal_ids.evidence_class).toBe("harness_observed");
      expect(packet.round_budget.evidence_class).toBe("derived");
      expect(packet.round_budget.value).toBe(3);
      expect(packet.wall_clock_budget.evidence_class).toBe("derived");
      expect(packet.wall_clock_budget.value).toBe(3600000);
      expect(packet.profile.evidence_class).toBe("agent_reported");
      expect(packet.profile.value).toBe("deliberate");
      expect(packet.prohibitions.evidence_class).toBe("harness_observed");
      expect(packet.prohibitions.value).toBe("Custom strict prohibitions");
      expect(packet.packet_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(packet.markdown).toContain("# Tier 1 Deployment Packet");
      expect(packet.markdown).toContain("orch-lane-1");
      expect(packet.markdown).toContain("Implement automated recovery harness");
    });

    it("uses default deliberate profile and default prohibitions when omitted", () => {
      const packet = buildTier1DeploymentPacket(validBaseInput);
      expect(packet.profile.value).toBe("deliberate");
      expect(packet.prohibitions.value).toBe(DEFAULT_PROHIBITIONS);
    });
  });

  describe("createTier1DeployInputFromCandidate", () => {
    const dummyCharter: ParsedCharter = {
      identity: "mind-0",
      goals: [{ id: "G1", statement: "Goal 1" }],
      goalIds: ["G1"],
      nonGoals: ["NG1"],
      repoRoots: ["."],
      prohibitions: "Never edit files outside workspace",
    };

    const dummyBudget: MindBudget = {
      pulses_per_day: 10,
      wall_clock_ms_per_day: 10000000,
      max_agents_in_flight: 2,
      max_rounds_per_objective: 4,
      base_interval_ms: 1000,
      max_interval_ms: 5000,
      max_pause_interval_ms: 10000,
      pulse_deadline_ms: 60000,
      max_open_proposals: 3,
      quiet_hours: null,
      day_key: "2026-09-01",
      pulses_today: 1,
      wall_clock_ms_today: 500000,
    };

    const baseCandidate: CandidateRecord = {
      id: "cand-1",
      statement: "Fix liveness timeout bug",
      rationale: "Stabilize heartbeat thread",
      charter_goal_ids: ["G1"],
      write_scope: ["src/lifecycle"],
      status: "admitted",
      witness_command_id: "cmd-witness-1",
      created_at: "2026-09-01T12:00:00.000Z",
      updated_at: "2026-09-01T12:00:00.000Z",
      fingerprint: "fp-1",
      proposer_agent_id: "mind-0",
      pulse_id: "pulse-1",
    };

    it("throws INVALID_STATE when candidate status is not admitted", () => {
      const nonAdmitted = { ...baseCandidate, status: "pending" as any };
      expect(() =>
        createTier1DeployInputFromCandidate(
          nonAdmitted,
          dummyCharter,
          dummyBudget,
          "run-1",
          "orch-1",
        ),
      ).toThrow(HarnessError);
    });

    it("throws INVALID_STATE when candidate has no witness_command_id", () => {
      const noWitness = { ...baseCandidate, witness_command_id: undefined as any };
      expect(() =>
        createTier1DeployInputFromCandidate(
          noWitness,
          dummyCharter,
          dummyBudget,
          "run-1",
          "orch-1",
        ),
      ).toThrow(HarnessError);
    });

    it("throws INVALID_STATE when candidate has no charter goals cited", () => {
      const emptyCharter: ParsedCharter = { ...dummyCharter, goalIds: [] };
      const noGoals = { ...baseCandidate, charter_goal_ids: [] as any, charter_goals: [] as any };
      expect(() =>
        createTier1DeployInputFromCandidate(noGoals, emptyCharter, dummyBudget, "run-1", "orch-1"),
      ).toThrow(HarnessError);
    });

    it("resolves candidate goalIds from candidate charter_goals or charter.goalIds fallback", () => {
      const candFallback = {
        ...baseCandidate,
        charter_goal_ids: undefined,
        charter_goals: ["G_ALT"],
      };
      const input = createTier1DeployInputFromCandidate(
        candFallback,
        dummyCharter,
        dummyBudget,
        "run-1",
        "orch-1",
      );
      expect(input.charterGoalIds).toEqual(["G_ALT"]);

      const candCharterFallback = {
        ...baseCandidate,
        charter_goal_ids: undefined,
        charter_goals: undefined,
      };
      const input2 = createTier1DeployInputFromCandidate(
        candCharterFallback,
        dummyCharter,
        dummyBudget,
        "run-1",
        "orch-1",
      );
      expect(input2.charterGoalIds).toEqual(["G1"]);
    });

    it("calculates remaining round and wall clock budgets with fallback floors", () => {
      const emptyBudget = {
        ...dummyBudget,
        wall_clock_ms_per_day: null,
        max_rounds_per_objective: null,
      };
      const input = createTier1DeployInputFromCandidate(
        baseCandidate,
        dummyCharter,
        emptyBudget,
        "run-1",
        "orch-1",
        { spentWallClockMsToday: 25000000 },
      );
      expect(input.remainingRoundBudget).toBe(3);
      expect(input.remainingWallClockBudgetMs).toBe(60000);
      expect(input.profile).toBe("deliberate");
      expect(input.prohibitions).toBe(dummyCharter.prohibitions);
    });
  });
});
