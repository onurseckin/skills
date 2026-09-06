import { describe, expect, it } from "bun:test";
import { checkRoleBoundaryInterlock } from "../../../olt/scripts/src/reporting/doctor/role-boundary-engine.ts";
import { inferRole } from "../../../olt/scripts/src/reporting/doctor/tier-confinement/constants.ts";
import { orchestratorProfile } from "../../../olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts";

export const suiteName = "Role Boundary Hardlocks - Shell Execution Restrictions";

describe(suiteName, () => {
  describe("Supervisor Shell Execution Tool Hardlocks", () => {
    it("emits ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT when orchestrator uses run_command via events", () => {
      const result = checkRoleBoundaryInterlock({
        events: [
          {
            type: "tool-call",
            payload: {
              agent_id: "orch-primary",
              role: "orchestrator",
              tool: "run_command",
            },
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]?.code).toBe("ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT");
      expect(result.findings[0]?.severity).toBe("ERROR");
      expect(result.findings[0]?.details?.agentId).toBe("orch-primary");
      expect(result.findings[0]?.details?.tool).toBe("run_command");
    });

    it("emits ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT when coordinator uses execute_command via events", () => {
      const result = checkRoleBoundaryInterlock({
        events: [
          {
            type: "tool-call",
            payload: {
              agent_id: "coord-task-1",
              role: "coordinator",
              tool: "execute_command",
            },
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT")).toBe(
        true,
      );
    });

    it("emits ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT for shell and exec tool invocations", () => {
      const result = checkRoleBoundaryInterlock({
        events: [
          {
            type: "tool-call",
            payload: {
              agent_id: "orch-secondary",
              role: "orchestrator",
              tool: "shell",
            },
          },
          {
            type: "tool-call",
            payload: {
              agent_id: "coord-secondary",
              role: "coordinator",
              tool: "exec",
            },
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.findings.length).toBe(2);
      expect(result.findings.every((f) => f.code === "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT")).toBe(
        true,
      );
    });

    it("emits ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT when supervisor grant contains run_command", () => {
      const result = checkRoleBoundaryInterlock({
        grants: [
          {
            id: "orch-grant-1",
            role: "orchestrator",
            tools_used: ["run_command"],
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.code === "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT")).toBe(
        true,
      );
    });

    it("resolves supervisor role by agentId prefix and emits violation", () => {
      const result = checkRoleBoundaryInterlock({
        events: [
          {
            type: "tool-call",
            payload: {
              agent_id: "orchestrator-main",
              tool: "run_command",
            },
          },
          {
            type: "tool-call",
            payload: {
              agent_id: "coordinator-dispatch",
              tool: "execute_command",
            },
          },
        ],
      });

      expect(result.passed).toBe(false);
      expect(result.findings.length).toBe(2);
      expect(result.findings.every((f) => f.code === "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT")).toBe(
        true,
      );
    });
  });

  describe("Implementer Shell Execution Allowance", () => {
    it("does NOT emit role boundary violations when implementer executes shell commands", () => {
      const result = checkRoleBoundaryInterlock({
        grants: [
          {
            id: "impl-builder",
            role: "implementer",
            tools_used: ["run_command", "execute_command", "shell", "exec"],
          },
        ],
        events: [
          {
            type: "tool-call",
            payload: {
              agent_id: "impl-builder",
              role: "implementer",
              tool: "run_command",
            },
          },
          {
            type: "tool-call",
            payload: {
              agent_id: "implementer-worker-2",
              tool: "execute_command",
            },
          },
        ],
      });

      expect(result.passed).toBe(true);
      expect(result.findings.length).toBe(0);
    });
  });

  describe("Tier 1 Orchestrator Diagnostic Profile Shell Lock", () => {
    it("has can_execute_shell set to false", () => {
      expect(orchestratorProfile.can_execute_shell).toBe(false);
    });

    it("emits ORCHESTRATOR_SHELL_EXECUTION_VIOLATION when executed_commands is non-empty", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: "orch-runner",
        role: "orchestrator",
        executed_commands: ["bun test", "git status"],
      });

      const shellViolations = violations.filter(
        (v) => v.code === "ORCHESTRATOR_SHELL_EXECUTION_VIOLATION",
      );
      expect(shellViolations.length).toBe(1);
      expect(shellViolations[0]?.severity).toBe("CRITICAL");
      expect(shellViolations[0]?.message).toBe(
        "Tier 1 Orchestrator must not execute shell commands; dispatch via Tier 2 Coordinator.",
      );
      expect(shellViolations[0]?.remediation_cmd).toBe(
        "bun harness.ts task:brief --role coordinator",
      );
      expect(shellViolations[0]?.documentation_ref).toBe(
        "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-31",
      );
    });

    it("does NOT emit ORCHESTRATOR_SHELL_EXECUTION_VIOLATION when executed_commands is empty or absent", () => {
      const withEmpty = orchestratorProfile.evaluate({
        agent_id: "orch-clean-1",
        role: "orchestrator",
        executed_commands: [],
      });
      expect(withEmpty.some((v) => v.code === "ORCHESTRATOR_SHELL_EXECUTION_VIOLATION")).toBe(
        false,
      );

      const withoutCommands = orchestratorProfile.evaluate({
        agent_id: "orch-clean-2",
        role: "orchestrator",
      });
      expect(withoutCommands.some((v) => v.code === "ORCHESTRATOR_SHELL_EXECUTION_VIOLATION")).toBe(
        false,
      );
    });
  });

  describe("User and Human Role Inference", () => {
    it("recognizes user and human actor identifiers via inferRole", () => {
      const emptyMap = new Map<string, string>();
      const emptyState = {};

      expect(inferRole("user", emptyMap, emptyState)).toBe("user");
      expect(inferRole("user-1", emptyMap, emptyState)).toBe("user");
      expect(inferRole("user_admin", emptyMap, emptyState)).toBe("user");
      expect(inferRole("human", emptyMap, emptyState)).toBe("user");
      expect(inferRole("human-reviewer", emptyMap, emptyState)).toBe("user");
      expect(inferRole("human_operator", emptyMap, emptyState)).toBe("user");
    });

    it("does NOT emit role boundary violations when user or human executes commands in interlock", () => {
      const result = checkRoleBoundaryInterlock({
        events: [
          {
            type: "tool-call",
            payload: {
              agent_id: "user-admin",
              tool: "run_command",
            },
          },
          {
            type: "tool-call",
            payload: {
              agent_id: "human-tester",
              tool: "execute_command",
            },
          },
        ],
      });

      expect(result.passed).toBe(true);
      expect(result.findings.length).toBe(0);
    });
  });
});
