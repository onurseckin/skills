import { describe, expect, test } from "bun:test";
import { mindProfile, orchestratorProfile } from "../../../olt/scripts/src/sentinel/index.ts";

describe("Platform-Independent Sentinel Interlocks & Cross-Tier Spawning", () => {
  describe("Task 1: mindProfile (Tier 0) Cross-Tier Spawning Enforcement", () => {
    test("mindProfile emits CROSS_TIER_SPAWNING_VIOLATION on child_agent_roles containing 'implementer'", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_root",
        role: "mind",
        child_agent_roles: ["implementer"],
      });

      expect(violations.length).toBe(1);
      const violation = violations[0];
      if (!violation) throw new Error("Expected violation");
      expect(violation.code).toBe("CROSS_TIER_SPAWNING_VIOLATION");
      expect(violation.severity).toBe("CRITICAL");
      expect(violation.message).toBe(
        "Tier 0 Mind must only dispatch Tier 1 Orchestrator; direct Tier 3 worker or Tier 2 coordinator dispatch collapses the 4-tier hierarchy.",
      );
      expect(violation.remediation_cmd).toBe("bun harness.ts task:brief --role orchestrator");
    });

    test("mindProfile emits CROSS_TIER_SPAWNING_VIOLATION on child_agent_roles containing 'coordinator'", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_root",
        role: "mind",
        child_agent_roles: ["coordinator"],
      });

      expect(violations.length).toBe(1);
      const violation = violations[0];
      if (!violation) throw new Error("Expected violation");
      expect(violation.code).toBe("CROSS_TIER_SPAWNING_VIOLATION");
      expect(violation.severity).toBe("CRITICAL");
    });

    test("mindProfile emits CROSS_TIER_SPAWNING_VIOLATION on child_agent_roles containing multiple invalid roles", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_root",
        role: "mind",
        child_agent_roles: ["coordinator", "implementer", "validator"],
      });

      expect(violations.length).toBe(3);
      for (const v of violations) {
        expect(v.code).toBe("CROSS_TIER_SPAWNING_VIOLATION");
        expect(v.severity).toBe("CRITICAL");
      }
    });

    test("mindProfile allows child_agent_roles containing 'orchestrator'", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_root",
        role: "mind",
        child_agent_roles: ["orchestrator"],
      });

      const crossTier = violations.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
      expect(crossTier.length).toBe(0);
    });

    test("mindProfile allows child_agent_roles containing 'mind-auditor' and 'skill-auditor'", () => {
      const violations = mindProfile.evaluate({
        agent_id: "mind_root",
        role: "mind",
        child_agent_roles: ["mind-auditor", "skill-auditor"],
      });

      const crossTier = violations.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
      expect(crossTier.length).toBe(0);
    });

    test("mindProfile checks spawned_agent_roles and role_target aliases", () => {
      const v1 = mindProfile.evaluate({
        agent_id: "mind_root",
        role: "mind",
        spawned_agent_roles: ["implementer"],
      });
      expect(v1.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);

      const v2 = mindProfile.evaluate({
        agent_id: "mind_root",
        role: "mind",
        role_target: "ui-headless-validator",
      });
      expect(v2.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);
    });

    test("mindProfile blocks rogue unknown child roles and safely handles empty context", () => {
      const rogueViolations = mindProfile.evaluate({
        agent_id: "mind_root",
        role: "mind",
        child_agent_roles: ["rogue_agent", "unauthorized_worker"],
      });
      expect(rogueViolations.length).toBe(2);
      for (const v of rogueViolations) {
        expect(v.code).toBe("CROSS_TIER_SPAWNING_VIOLATION");
      }

      const emptyViolations = mindProfile.evaluate({
        agent_id: "mind_empty",
        role: "mind",
      });
      expect(Array.isArray(emptyViolations)).toBe(true);
      expect(emptyViolations.length).toBe(0);
    });
  });

  describe("Task 2: orchestratorProfile (Tier 1) Cross-Tier Spawning Enforcement", () => {
    test("orchestratorProfile emits CROSS_TIER_SPAWNING_VIOLATION on child_agent_roles containing 'implementer'", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: "orch_01",
        role: "orchestrator",
        child_agent_roles: ["implementer"],
      });

      expect(violations.length).toBe(1);
      const violation = violations[0];
      if (!violation) throw new Error("Expected violation");
      expect(violation.code).toBe("CROSS_TIER_SPAWNING_VIOLATION");
      expect(violation.severity).toBe("CRITICAL");
      expect(violation.message).toBe(
        "Tier 1 Orchestrator must only dispatch Tier 2 Coordinator; direct Tier 3 worker dispatch is prohibited.",
      );
      expect(violation.remediation_cmd).toBe("bun harness.ts task:brief --role coordinator");
    });

    test("orchestratorProfile emits CROSS_TIER_SPAWNING_VIOLATION on child_agent_roles containing 'validator'", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: "orch_01",
        role: "orchestrator",
        child_agent_roles: ["validator"],
      });

      expect(violations.length).toBe(1);
      const violation = violations[0];
      if (!violation) throw new Error("Expected violation");
      expect(violation.code).toBe("CROSS_TIER_SPAWNING_VIOLATION");
      expect(violation.severity).toBe("CRITICAL");
    });

    test("orchestratorProfile allows child_agent_roles containing 'coordinator'", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: "orch_01",
        role: "orchestrator",
        child_agent_roles: ["coordinator"],
      });

      const crossTier = violations.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
      expect(crossTier.length).toBe(0);
    });

    test("orchestratorProfile checks spawned_agent_roles and role_target aliases", () => {
      const v1 = orchestratorProfile.evaluate({
        agent_id: "orch_01",
        role: "orchestrator",
        spawned_agent_roles: ["implementer"],
      });
      expect(v1.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);

      const v2 = orchestratorProfile.evaluate({
        agent_id: "orch_01",
        role: "orchestrator",
        role_target: "implementer",
      });
      expect(v2.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);
    });

    test("orchestratorProfile blocks rogue child roles and safely handles empty context", () => {
      const rogueViolations = orchestratorProfile.evaluate({
        agent_id: "orch_01",
        role: "orchestrator",
        child_agent_roles: ["rogue_worker"],
      });
      expect(rogueViolations.length).toBe(1);
      const first = rogueViolations[0];
      if (!first) throw new Error("Expected violation");
      expect(first.code).toBe("CROSS_TIER_SPAWNING_VIOLATION");

      const emptyViolations = orchestratorProfile.evaluate({
        agent_id: "orch_empty",
        role: "orchestrator",
      });
      expect(Array.isArray(emptyViolations)).toBe(true);
      expect(emptyViolations.length).toBe(0);
    });
  });
});
