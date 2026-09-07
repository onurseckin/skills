import { describe, expect, test } from "bun:test";
import { roleToTier } from "../../../olt/scripts/src/authority/guards/spawn-validator.ts";
import {
  executeTurnEndHook,
  mindProfile,
  orchestratorProfile,
  runDoctorAgent,
} from "../../../olt/scripts/src/sentinel/index.ts";

describe("Tier Spawning Hierarchy & Anti-Bottleneck Sentinel Enforcement", () => {
  describe("roleToTier semantic mapping", () => {
    test("maps standard and prefixed roles to expected execution tiers", () => {
      const cases =
        "mind:0,human:0,lead:0,orchestrator:1,orchestrator_reporting:1,orchestrator-domain:1,orch_review:1,orch-pulse:1,mind-auditor:1,auditor:1,coordinator:2,coordinator_wave1:2,coordinator-backend:2,coord_infra:2,coord-domain:2,implementer:3,validator:3,sub-implementer:3,completeness-critic:3,unknown-role:3";
      for (const pair of cases.split(",")) {
        const [role, tier] = pair.split(":");
        expect(roleToTier(role!)).toBe(Number(tier));
      }
    });
  });

  describe("mindProfile semantic spawning", () => {
    test("allows mind to spawn Tier 1 roles and skill-auditor", () => {
      const allowedRoles =
        "orchestrator,orchestrator_reporting,orchestrator-domain,orch_wave,orch-pulse,mind-auditor,skill-auditor".split(
          ",",
        );
      for (const role of allowedRoles) {
        const violations = mindProfile.evaluate({
          agent_id: "mind_01",
          role: "mind",
          child_agent_roles: [role],
        });
        expect(violations.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toHaveLength(
          0,
        );
      }
    });

    test("rejects mind spawning Tier 0, Tier 2, and Tier 3 roles", () => {
      const forbiddenRoles =
        "mind,coordinator,coordinator_wave1,coordinator-infra,coord_ops,implementer,validator,sub-implementer,completeness-critic".split(
          ",",
        );
      for (const role of forbiddenRoles) {
        const violations = mindProfile.evaluate({
          agent_id: "mind_01",
          role: "mind",
          child_agent_roles: [role],
        });
        const spawnViolation = violations.find((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
        expect(spawnViolation).toBeDefined();
        expect(spawnViolation?.severity).toBe("CRITICAL");
        expect(spawnViolation?.remediation_cmd).toBe(
          "bun harness.ts task:brief --role orchestrator",
        );
        expect(spawnViolation?.documentation_ref).toBe(
          "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
        );
      }
    });

    test("validates candidates across spawned_agent_roles, spawned_roles, and role_target", () => {
      const viaSpawnedAgentRoles = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        spawned_agent_roles: ["coordinator"],
      });
      expect(viaSpawnedAgentRoles.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(
        true,
      );

      const viaSpawnedRoles = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        spawned_roles: ["implementer"],
      });
      expect(viaSpawnedRoles.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);

      const viaRoleTarget = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        role_target: "validator",
      });
      expect(viaRoleTarget.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);
    });
  });

  describe("mindProfile anti-bottleneck gate", () => {
    test("flags SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION when cluster_count >= 2 and active_orchestrator_count < 2", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        cluster_count: 2,
        active_orchestrator_count: 1,
      });
      const bottleneck = violations.find(
        (v) => v.code === "SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION",
      );
      expect(bottleneck).toBeDefined();
      expect(bottleneck?.severity).toBe("CRITICAL");
      expect(bottleneck?.message).toBe(
        "Mind multi-cluster preplanning requires >= 2 active orchestrators to prevent bottleneck.",
      );
      expect(bottleneck?.remediation_cmd).toBe("bun harness.ts orchestrate --tier orchestrator");
      expect(bottleneck?.documentation_ref).toBe(
        "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
      );
    });

    test("flags bottleneck when active_orchestrator_count is omitted or 0 for >= 2 clusters", () => {
      const omittedViolations = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        cluster_count: 3,
      });
      expect(
        omittedViolations.some((v) => v.code === "SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION"),
      ).toBe(true);

      const zeroViolations = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        cluster_count: 2,
        active_orchestrator_count: 0,
      });
      expect(
        zeroViolations.some((v) => v.code === "SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION"),
      ).toBe(true);
    });

    test("passes when active_orchestrator_count is sufficient or cluster_count < 2", () => {
      const sufficient = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        cluster_count: 2,
        active_orchestrator_count: 2,
      });
      expect(
        sufficient.filter((v) => v.code === "SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION"),
      ).toHaveLength(0);

      const excess = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        cluster_count: 4,
        active_orchestrator_count: 5,
      });
      expect(
        excess.filter((v) => v.code === "SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION"),
      ).toHaveLength(0);

      const singleCluster = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
        cluster_count: 1,
        active_orchestrator_count: 1,
      });
      expect(
        singleCluster.filter((v) => v.code === "SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION"),
      ).toHaveLength(0);

      const unconfigured = mindProfile.evaluate({
        agent_id: "mind_01",
        role: "mind",
      });
      expect(
        unconfigured.filter((v) => v.code === "SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION"),
      ).toHaveLength(0);
    });
  });

  describe("orchestratorProfile semantic spawning", () => {
    test("permits Tier 2 roles (roleToTier(role) === 2)", () => {
      const allowedRoles = [
        "coordinator",
        "coordinator_wave1",
        "coordinator-backend",
        "coord_infra",
        "coord-planning",
      ];
      for (const role of allowedRoles) {
        const violations = orchestratorProfile.evaluate({
          agent_id: "orch_01",
          role: "orchestrator",
          child_agent_roles: [role],
        });
        expect(violations.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toHaveLength(
          0,
        );
      }
    });

    test("rejects Tier 0, Tier 1, and Tier 3 spawns (roleToTier(role) !== 2)", () => {
      const forbiddenRoles = [
        "mind",
        "human",
        "orchestrator",
        "orchestrator_reporting",
        "orchestrator-domain",
        "mind-auditor",
        "implementer",
        "validator",
        "sub-implementer",
        "completeness-critic",
      ];
      for (const role of forbiddenRoles) {
        const violations = orchestratorProfile.evaluate({
          agent_id: "orch_01",
          role: "orchestrator",
          child_agent_roles: [role],
        });
        const spawnViolation = violations.find((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
        expect(spawnViolation).toBeDefined();
        expect(spawnViolation?.severity).toBe("CRITICAL");
        expect(spawnViolation?.message).toBe(
          "Tier 1 Orchestrator must only dispatch Tier 2 Coordinator; direct Tier 3 worker dispatch is prohibited.",
        );
        expect(spawnViolation?.remediation_cmd).toBe(
          "bun harness.ts task:brief --role coordinator",
        );
        expect(spawnViolation?.documentation_ref).toBe(
          "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-31",
        );
      }
    });

    test("validates candidates across all context spawn fields", () => {
      const viaSpawnedRoles = orchestratorProfile.evaluate({
        agent_id: "orch_01",
        role: "orchestrator",
        spawned_roles: ["implementer"],
      });
      expect(viaSpawnedRoles.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);

      const viaRoleTarget = orchestratorProfile.evaluate({
        agent_id: "orch_01",
        role: "orchestrator",
        role_target: "orchestrator_reporting",
      });
      expect(viaRoleTarget.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);
    });
  });

  describe("end-to-end integration via runner and hooks", () => {
    test("runDoctorAgent catches single orchestrator bottleneck", () => {
      const report = runDoctorAgent({
        agentId: "mind_exec",
        role: "mind",
        cluster_count: 3,
        active_orchestrator_count: 1,
      });
      expect(report.status).toBe("VIOLATION_DETECTED");
      expect(
        report.violations.some((v) => v.code === "SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION"),
      ).toBe(true);
    });

    test("executeTurnEndHook permits semantic coordinator spawning and rejects worker spawning", () => {
      const allowedResult = executeTurnEndHook({
        agent_id: "orch_exec",
        role: "orchestrator",
        child_agent_roles: ["coordinator_wave1"],
      });
      expect(allowedResult.violations.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(
        false,
      );

      const rejectedResult = executeTurnEndHook({
        agent_id: "orch_exec",
        role: "orchestrator",
        child_agent_roles: ["implementer"],
      });
      expect(
        rejectedResult.violations.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION"),
      ).toBe(true);
      expect(rejectedResult.status).toBe("VIOLATION_DETECTED");
    });
  });
});
