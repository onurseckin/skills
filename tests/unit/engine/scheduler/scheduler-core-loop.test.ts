import { describe, expect, it } from "bun:test";
import {
  probePlanEnhancementNeeds,
  probeAgentRegistryAccuracy,
  probeRoleBoundaryAdherence,
} from "../../../../olt/scripts/src/engine/scheduler/core/loop.ts";

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
            null, // non-record ignored
            { title: "No ID" }, // missing id ignored
          ],
        },
        tasks: {
          t1: { id: "t1", status: "ready", requirement_ids: ["req-1", "req-2"] },
        },
      };

      const resultNested = probePlanEnhancementNeeds(stateNested);
      expect(resultNested.passed).toBe(true);
      expect(resultNested.totalRequirements).toBe(2);
      expect(resultNested.unfulfilledRequirementsCount).toBe(0);
      expect(resultNested.needsReplanning).toBe(false);
      expect(resultNested.details[0]).toContain("Plan is coherent and complete");

      const stateUncovered = {
        requirements: {
          requirements: [
            { id: "req-direct-1" },
            { id: "req-direct-2" },
          ],
        },
        tasks: {
          t1: { id: "t1", status: "ready", requirement_ids: ["req-direct-1"] },
        },
      };

      const resultDirect = probePlanEnhancementNeeds(stateUncovered);
      expect(resultDirect.passed).toBe(false);
      expect(resultDirect.totalRequirements).toBe(2);
      expect(resultDirect.unfulfilledRequirementsCount).toBe(1);
      expect(resultDirect.needsReplanning).toBe(true);
      expect(resultDirect.suggestedEnhancements).toContain("Requirement 'req-direct-2' has no assigned tasks.");
    });

    it("identifies tasks in changes_requested or stale status needing repair/replan", () => {
      const state = {
        requirements: [{ id: "req-1" }],
        tasks: {
          t1: { id: "t1", status: "changes_requested", requirement_ids: ["req-1"] },
          t2: { id: "t2", status: "stale", requirement_ids: ["req-1"] },
          t3: null, // non-record ignored
        },
      };

      const result = probePlanEnhancementNeeds(state);
      expect(result.passed).toBe(false);
      expect(result.needsReplanning).toBe(true);
      expect(result.suggestedEnhancements).toContain(
        "Task 't1' in 'changes_requested' status requires repair or replan enhancement.",
      );
      expect(result.suggestedEnhancements).toContain(
        "Task 't2' in 'stale' status requires repair or replan enhancement.",
      );
    });

    it("counts proposed mind candidates pending admission", () => {
      const state = {
        requirements: [{ id: "req-1" }],
        tasks: {
          t1: { id: "t1", status: "ready", requirement_ids: ["req-1"] },
        },
        mind: {
          candidates: [
            { id: "c1", status: "proposed" },
            { id: "c2", status: "proposed" },
            { id: "c3", status: "admitted" },
            null,
          ],
        },
      };

      const result = probePlanEnhancementNeeds(state);
      expect(result.passed).toBe(false);
      expect(result.pendingCandidateCount).toBe(2);
      expect(result.suggestedEnhancements).toContain("2 proposed mind candidate(s) pending admission.");
    });
  });

  describe("probeAgentRegistryAccuracy", () => {
    it("returns default 100% accuracy when state is not a record", () => {
      const result = probeAgentRegistryAccuracy(undefined);
      expect(result.passed).toBe(true);
      expect(result.totalRegistered).toBe(0);
      expect(result.accuracyPercentage).toBe(100);
      expect(result.details).toEqual(["No agents or tasks record to audit."]);
    });

    it("verifies accurate agent registry when all active leases match registered grants", () => {
      const state = {
        agents: [
          { id: "agent-1", role: "implementer", status: "active" },
          { id: "agent-2", role: "validator" }, // status defaults to "active"
          null, // invalid record ignored
        ],
        tasks: {
          t1: {
            id: "t1",
            status: "running",
            lease: { agent_id: "agent-1", role: "implementer" },
          },
          t2: {
            id: "t2",
            status: "validating",
            lease: { agent_id: "agent-2", role: "validator" },
          },
          t3: {
            id: "t3",
            status: "done", // not an active lease status
            lease: { agent_id: "agent-1", role: "implementer" },
          },
          t4: null, // non-record ignored
        },
      };

      const result = probeAgentRegistryAccuracy(state);
      expect(result.passed).toBe(true);
      expect(result.totalRegistered).toBe(2);
      expect(result.totalActiveGrants).toBe(2);
      expect(result.totalActiveLeases).toBe(2);
      expect(result.accuracyPercentage).toBe(100);
      expect(result.unmappedLeaseAgents).toEqual([]);
      expect(result.mismatchedRoleAgents).toEqual([]);
      expect(result.ghostAgentIds).toEqual([]);
      expect(result.details[0]).toContain("Agent registry has 100% accuracy");
    });

    it("detects ghost agents, inactive agents, and role mismatches", () => {
      const state = {
        agents: [
          { id: "agent-active", role: "implementer", status: "active" },
          { id: "agent-inactive", role: "implementer", status: "inactive" },
        ],
        tasks: {
          t1: {
            id: "t1",
            status: "leased",
            lease: { agent_id: "agent-ghost", role: "implementer" },
          },
          t2: {
            id: "t2",
            status: "running",
            lease: { agent_id: "agent-inactive", role: "implementer" },
          },
          t3: {
            id: "t3",
            status: "validating",
            lease: { agent_id: "agent-active", role: "validator" }, // role mismatch
          },
          t4: {
            id: "t4",
            status: "leased",
            lease: {}, // non-string agent_id and role fallback to "unknown"
          },
        },
      };

      const result = probeAgentRegistryAccuracy(state);
      expect(result.passed).toBe(false);
      expect(result.totalActiveLeases).toBe(4);
      expect(result.ghostAgentIds).toContain("agent-ghost");
      expect(result.ghostAgentIds).toContain("unknown");
      expect(result.unmappedLeaseAgents).toContain("agent-inactive");
      expect(result.mismatchedRoleAgents).toContain("agent-active");
      expect(result.accuracyPercentage).toBe(0);
    });
  });

  describe("probeRoleBoundaryAdherence", () => {
    it("verifies clean adherence when tasks follow role boundaries without runRoot", () => {
      const state = {
        tasks: {
          t1: {
            id: "t1",
            status: "validating",
            lease: { role: "validator" },
          },
          t2: {
            id: "t2",
            status: "running",
            lease: { role: "implementer" },
          },
          t3: {
            id: "t3",
            status: "leased",
            lease: { role: "implementer" },
          },
          t4: {
            id: "t4",
            status: "done",
            lease: { role: "validator" },
          },
          t5: null,
        },
      };

      const result = probeRoleBoundaryAdherence(state);
      expect(result.passed).toBe(true);
      expect(result.hierarchicalViolations).toEqual([]);
      expect(result.tierConfinementViolations).toEqual([]);
      expect(result.details[0]).toContain("strictly adhere to hierarchical tier confinement");
    });

    it("detects hierarchical role violations in state tasks", () => {
      const state = {
        tasks: {
          t1: {
            id: "t1",
            status: "validating",
            lease: { role: "implementer" }, // violation: validating must be validator
          },
          t2: {
            id: "t2",
            status: "running",
            lease: { role: "validator" }, // violation: running must be implementer
          },
          t3: {
            id: "t3",
            status: "leased",
            lease: { role: "critic" }, // violation: leased must be implementer
          },
        },
      };

      const result = probeRoleBoundaryAdherence(state);
      expect(result.passed).toBe(false);
      expect(result.hierarchicalViolations.length).toBe(3);
      expect(result.hierarchicalViolations[0]).toContain(
        "Task 't1' in validating status held by non-validator role 'implementer'.",
      );
      expect(result.hierarchicalViolations[1]).toContain(
        "Task 't2' in running status held by non-implementer role 'validator'.",
      );
      expect(result.hierarchicalViolations[2]).toContain(
        "Task 't3' in leased status held by non-implementer role 'critic'.",
      );
    });

    it("audits behavioral health when runRoot is provided and handles audit errors", () => {
      // With non-existent runRoot, auditBehavioralHealth handles or throws safely
      const result = probeRoleBoundaryAdherence({}, "/non/existent/run/root/path");
      expect(Array.isArray(result.tierConfinementViolations)).toBe(true);
      expect(Array.isArray(result.details)).toBe(true);

      // Trigger catch block in probeRoleBoundaryAdherence via throwing state property during behavioral audit
      const throwingState = {
        schema: "harness.run-state",
        version: 1,
        tasks: {},
        get commands(): unknown {
          throw new Error("Behavioral auditor commands explosion");
        },
      };

      const resultError = probeRoleBoundaryAdherence(throwingState, "");
      expect(resultError.passed).toBe(false);
      expect(resultError.tierConfinementViolations.some((v) => v.includes("behavioral_evidence_unavailable"))).toBe(true);
    });
  });
});
