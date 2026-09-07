import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  executePreActionHook,
  mindProfile,
  orchestratorProfile,
} from "../../../olt/scripts/src/sentinel/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

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

  describe("Task 4: executePreActionHook & Pure In-Harness Interlock Middleware", () => {
    test("executePreActionHook blocks prohibited shell command", () => {
      const res = executePreActionHook({
        agent_id: "val_01",
        role: "validator",
        action_type: "shell_command",
        target: "bun test tests/unit/auth.test.ts",
      });

      expect(res.allowed).toBe(false);
      expect(res.code).toBe("ROLE_BOUNDARY_DEVIATION");
      expect(res.reason).toContain("restricted from executing terminal commands");
      expect(res.remediation).toBe("Perform review or validation using read-only APIs.");
    });

    test("executePreActionHook blocks prohibited file mutation", () => {
      const res = executePreActionHook({
        agent_id: "coord_01",
        role: "coordinator",
        action_type: "file_write",
        target: "src/main.ts",
      });

      expect(res.allowed).toBe(false);
      expect(res.code).toBe("ROLE_BOUNDARY_DEVIATION");
      expect(res.reason).toContain("does not hold file write privileges");
      expect(res.remediation).toBe("Delegate implementation tasks to an authorized Implementer.");
    });

    async function assertCliHarnessError(args: string[], expectedSnippet: string): Promise<void> {
      let didThrow = false;
      try {
        await execute(args);
      } catch (error: unknown) {
        didThrow = true;
        expect(error instanceof HarnessError).toBe(true);
        const harnessErr = error as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(harnessErr.message).toContain(expectedSnippet);
      }
      expect(didThrow).toBe(true);
    }

    test("execute blocks prohibited shell command in CLI middleware with ROLE_CONFINEMENT_VIOLATION", async () => {
      await assertCliHarnessError(
        [
          "shell",
          "--actor",
          "val-1",
          "--role",
          "validator",
          "--",
          "bun",
          "test",
          "tests/unit/auth.test.ts",
        ],
        "restricted from executing terminal commands",
      );
    });

    test("execute blocks prohibited file mutation in CLI middleware with ROLE_CONFINEMENT_VIOLATION", async () => {
      await assertCliHarnessError(
        ["shell", "--actor", "coord-1", "--role", "coordinator", "--", "touch", "src/index.ts"],
        "does not hold file write privileges",
      );
    });

    test("execute blocks file mutation outside leased write scope with ROLE_CONFINEMENT_VIOLATION", async () => {
      await assertCliHarnessError(
        [
          "shell",
          "--actor",
          "imp-1",
          "--role",
          "implementer",
          "--write-scope",
          "src/features/login.ts",
          "--",
          "touch",
          "src/other/secrets.ts",
        ],
        "falls outside the leased write scope",
      );
    });

    test("execute blocks agent:register when Mind attempts to spawn Implementer directly", async () => {
      await assertCliHarnessError(
        [
          "agent:register",
          "--run",
          "/tmp/fake-run",
          "--agent",
          "worker-1",
          "--role",
          "implementer",
          "--host",
          "claude-code",
          "--parent-agent",
          "mind",
        ],
        "Tier 0 Mind must only dispatch Tier 1 Orchestrator; direct Tier 3 worker or Tier 2 coordinator dispatch collapses the 4-tier hierarchy.",
      );
    });

    test("execute blocks agent:register when Orchestrator attempts to spawn Implementer directly", async () => {
      await assertCliHarnessError(
        [
          "agent:register",
          "--run",
          "/tmp/fake-run",
          "--agent",
          "worker-1",
          "--role",
          "implementer",
          "--host",
          "claude-code",
          "--parent-agent",
          "orchestrator",
        ],
        "Tier 1 Orchestrator must only dispatch Tier 2 Coordinator; direct Tier 3 worker dispatch is prohibited.",
      );
    });

    test("execute blocks agent:register when Mind attempts to spawn Coordinator directly", async () => {
      await assertCliHarnessError(
        [
          "agent:register",
          "--run",
          "/tmp/fake-run",
          "--agent",
          "coord-1",
          "--role",
          "coordinator",
          "--host",
          "claude-code",
          "--parent-agent",
          "mind",
        ],
        "Tier 0 Mind must only dispatch Tier 1 Orchestrator; direct Tier 3 worker or Tier 2 coordinator dispatch collapses the 4-tier hierarchy.",
      );
    });

    test("execute blocks detached background subshells with rogue tokens", async () => {
      await assertCliHarnessError(
        [
          "shell",
          "--actor",
          "imp-1",
          "--role",
          "implementer",
          "--",
          "nohup",
          "bun",
          "run",
          "server.ts",
          "&",
        ],
        "Detached processes and unmonitored background subshells",
      );
    });
  });
});
