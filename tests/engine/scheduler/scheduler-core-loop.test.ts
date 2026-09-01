import { describe, expect, it } from "bun:test";
import {
  probePlanEnhancementNeeds,
  probeAgentRegistryAccuracy,
  probeRoleBoundaryAdherence,
} from "../../../olt/scripts/src/engine/scheduler/core/loop.ts";

describe("engine/scheduler/core/loop.ts", () => {
  describe("probePlanEnhancementNeeds", () => {
    it("returns default coherent report when state is not a record", () => {
      const resultNull = probePlanEnhancementNeeds(null);
      expect(resultNull.passed).toBe(true);
      expect(resultNull.totalRequirements).toBe(0);
      expect(resultNull.needsReplanning).toBe(false);
      expect(resultNull.details).toEqual(["No requirements record found."]);

      const resultString = probePlanEnhancementNeeds("not-an-object");
      expect(resultString.passed).toBe(true);
      expect(resultString.totalRequirements).toBe(0);
    });

    it("evaluates requirements record with direct array or nested requirements array", () => {
      const stateNested = {
        requirements: {
          requirements: [
            { id: "req-1", title: "R1" },
            { id: "req-2", title: "R2" },
            null,
            { title: "No ID" },
          ],
        },
        tasks: { t1: { id: "t1", status: "ready", requirement_ids: ["req-1", "req-2"] } },
      };

      const resultNested = probePlanEnhancementNeeds(stateNested);
      expect(resultNested.passed).toBe(true);
      expect(resultNested.totalRequirements).toBe(2);
      expect(resultNested.unfulfilledRequirementsCount).toBe(0);
      expect(resultNested.needsReplanning).toBe(false);
      expect(resultNested.details[0]).toContain("Plan is coherent and complete");

      const stateUncovered = {
        requirements: { requirements: [{ id: "req-direct-1" }, { id: "req-direct-2" }] },
        tasks: { t1: { id: "t1", status: "ready", requirement_ids: ["req-direct-1"] } },
      };
      const resultUncovered = probePlanEnhancementNeeds(stateUncovered);
      expect(resultUncovered.passed).toBe(false);
      expect(resultUncovered.unfulfilledRequirementsCount).toBe(1);
      expect(resultUncovered.needsReplanning).toBe(true);
      expect(resultUncovered.details).toContain(
        "Requirement 'req-direct-2' has no assigned tasks.",
      );
    });

    it("detects task status changes_requested and pending mind candidates", () => {
      const state = {
        requirements: { requirements: [{ id: "req-1" }] },
        tasks: { t1: { id: "t1", status: "changes_requested", requirement_ids: ["req-1"] } },
        mind: { candidates: [{ status: "proposed" }] },
      };
      const result = probePlanEnhancementNeeds(state);
      expect(result.passed).toBe(false);
      expect(result.needsReplanning).toBe(true);
      expect(result.pendingCandidateCount).toBe(1);
    });
  });

  describe("probeAgentRegistryAccuracy", () => {
    it("handles non-record state objects gracefully", () => {
      const result = probeAgentRegistryAccuracy(null);
      expect(result.passed).toBe(true);
      expect(result.totalRegistered).toBe(0);
      expect(result.accuracyPercentage).toBe(100);
      expect(result.details).toEqual(["No agents or tasks record to audit."]);
    });

    it("checks agents array format, detecting active and ghost agent leases", () => {
      const state = {
        agents: [
          { id: "agent-1", role: "implementer", status: "active" },
          { id: "agent-2", role: "critic", status: "inactive" },
        ],
        tasks: {
          t1: { id: "t1", status: "leased", lease: { agent_id: "agent-1", role: "implementer" } },
          t2: { id: "t2", status: "running", lease: { agent_id: "ghost-1", role: "implementer" } },
          t3: { id: "t3", status: "leased", lease: { agent_id: "agent-2", role: "critic" } },
        },
      };

      const result = probeAgentRegistryAccuracy(state);
      expect(result.totalRegistered).toBe(2);
      expect(result.totalActiveGrants).toBe(1);
      expect(result.totalActiveLeases).toBe(3);
      expect(result.ghostAgentIds).toContain("ghost-1");
      expect(result.unmappedLeaseAgents).toContain("agent-2");
      expect(result.passed).toBe(false);
    });

    it("detects role mismatch between lease and registered grant", () => {
      const state = {
        agents: [{ id: "agent-1", role: "implementer", status: "active" }],
        tasks: {
          t1: { id: "t1", status: "leased", lease: { agent_id: "agent-1", role: "validator" } },
        },
      };

      const result = probeAgentRegistryAccuracy(state);
      expect(result.passed).toBe(false);
      expect(result.mismatchedRoleAgents).toContain("agent-1");
    });
  });

  describe("probeRoleBoundaryAdherence", () => {
    it("handles non-record state objects gracefully", () => {
      const result = probeRoleBoundaryAdherence(null);
      expect(result.passed).toBe(true);
      expect(result.hierarchicalViolations.length).toBe(0);
      expect(result.tierConfinementViolations.length).toBe(0);
    });

    it("verifies validating status requires validator role and leased/running requires implementer", () => {
      const validState = {
        tasks: {
          t1: { id: "t1", status: "leased", lease: { role: "implementer" } },
          t2: { id: "t2", status: "validating", lease: { role: "validator" } },
        },
      };
      const validResult = probeRoleBoundaryAdherence(validState);
      expect(validResult.passed).toBe(true);
      expect(validResult.hierarchicalViolations.length).toBe(0);

      const invalidState = {
        tasks: {
          t1: { id: "t1", status: "leased", lease: { role: "validator" } },
          t2: { id: "t2", status: "validating", lease: { role: "implementer" } },
        },
      };
      const invalidResult = probeRoleBoundaryAdherence(invalidState);
      expect(invalidResult.passed).toBe(false);
      expect(invalidResult.hierarchicalViolations.length).toBe(2);
    });
  });
});
