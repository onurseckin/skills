import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  ALLOWED_SUPERVISORY_TOOLS,
  DEFAULT_REVOKED_TOOLS,
  MechanicalContainmentEngine,
  type AgentContainmentState,
} from "../../../olt/scripts/src/mind/containment/index.ts";
import {
  assertSupervisoryContainment,
  checkSupervisoryContainment,
  detectSupervisoryViolation,
  isSupervisoryRoleForContainment,
  resetDefaultContainmentEngine,
} from "../../../olt/scripts/src/authority/guards/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("MechanicalContainmentEngine", () => {
beforeEach(() => {
    resetDefaultContainmentEngine();
  });

  afterEach(() => {
    resetDefaultContainmentEngine();
  });

describe("Three-Strike Mechanical Containment State Machine", () => {
    it("starts in Nominal state (Strike 0)", () => {
      const engine = new MechanicalContainmentEngine();
      const state = engine.getAgentState("supervisor-1");

      expect(state.strikeCount).toBe(0);
      expect(state.capabilitiesRevoked).toBe(false);
      expect(state.isTerminated).toBe(false);
      expect(state.violations).toHaveLength(0);
      expect(state.revokedTools).toHaveLength(0);
    });

    it("executes Strike 1: Intercept & Force Delegation (HALT_AND_DELEGATE)", () => {
      const engine = new MechanicalContainmentEngine();
      const agentId = "coord-feature-1";
      const role = "coordinator";

      const res1 = engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "write_to_file",
        targetFile: "src/feature/service.ts",
      });

      expect(res1.action).toBe("HALT_AND_DELEGATE");
      expect(res1.strikeLevel).toBe(1);
      expect(res1.blocked).toBe(true);
      expect(res1.respawnRequired).toBe(false);
      expect(res1.sanitizedState).toBe(false);
      expect(res1.message).toContain("STRIKE 1 - HALT_AND_DELEGATE");
      expect(res1.message).toContain("Decompose the task into discrete work units");
      expect(res1.message).toContain("invoke_subagent");

      const state1 = engine.getAgentState(agentId);
      expect(state1.strikeCount).toBe(1);
      expect(state1.capabilitiesRevoked).toBe(false);
      expect(state1.isTerminated).toBe(false);
      expect(state1.violations).toHaveLength(1);
      expect(state1.violations[0]?.violationType).toBe("DIRECT_CODE_EDIT");
    });

    it("executes Strike 2: Hard Capability Revocation (CAPABILITY_REVOCATION)", () => {
      const engine = new MechanicalContainmentEngine();
      const agentId = "orch-release-1";
      const role = "orchestrator";

      // Strike 1
      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_TEST_RUN",
        attemptedAction: "bun test tests/unit",
      });

      // Strike 2
      const res2 = engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "replace_file_content",
        targetFile: "src/core/runner.ts",
      });

      expect(res2.action).toBe("CAPABILITY_REVOCATION");
      expect(res2.strikeLevel).toBe(2);
      expect(res2.blocked).toBe(true);
      expect(res2.respawnRequired).toBe(false);
      expect(res2.sanitizedState).toBe(false);
      expect(res2.message).toContain("STRIKE 2 - CAPABILITY_REVOCATION");
      expect(res2.revokedTools).toBeDefined();
      expect(res2.revokedTools).toContain("write_to_file");
      expect(res2.revokedTools).toContain("run_command");

      const state2 = engine.getAgentState(agentId);
      expect(state2.strikeCount).toBe(2);
      expect(state2.capabilitiesRevoked).toBe(true);
      expect(state2.isTerminated).toBe(false);
      expect(state2.violations).toHaveLength(2);
    });

    it("executes Strike 3: Persona Re-Spawn (PERSONA_RESPAWN) and blocks further actions", () => {
      const engine = new MechanicalContainmentEngine();
      const agentId = "mind-lead-1";
      const role = "mind";

      // Strike 1
      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "edit_file",
        targetFile: "src/mind/main.ts",
      });

      // Strike 2
      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_MUTATION_COMMAND",
        attemptedAction: "git commit -m 'rogue edit'",
      });

      // Strike 3
      const res3 = engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_TEST_RUN",
        attemptedAction: "bun test",
      });

      expect(res3.action).toBe("PERSONA_RESPAWN");
      expect(res3.strikeLevel).toBe(3);
      expect(res3.blocked).toBe(true);
      expect(res3.respawnRequired).toBe(true);
      expect(res3.sanitizedState).toBe(true);
      expect(res3.message).toContain("STRIKE 3 - PERSONA_RESPAWN");
      expect(res3.message).toContain("Agent terminated");

      const state3 = engine.getAgentState(agentId);
      expect(state3.strikeCount).toBe(3);
      expect(state3.capabilitiesRevoked).toBe(true);
      expect(state3.isTerminated).toBe(true);

      // Subsequent action attempts on terminated agent are unconditionally blocked
      const resTerminated = engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "write_to_file",
      });
      expect(resTerminated.action).toBe("PERSONA_RESPAWN");
      expect(resTerminated.blocked).toBe(true);
      expect(resTerminated.respawnRequired).toBe(true);
    });
  });

describe("Tool Permissions across Containment Levels", () => {
    it("allows all tools at Strike 0, restricts write/exec tools at Strike 2, and denies all tools at Strike 3", () => {
      const engine = new MechanicalContainmentEngine();
      const agentId = "coord-perm-test";
      const role = "coordinator";

      // Strike 0: all tools permitted
      expect(engine.isToolPermitted(agentId, role, "write_to_file")).toBe(true);
      expect(engine.isToolPermitted(agentId, role, "run_command")).toBe(true);
      expect(engine.isToolPermitted(agentId, role, "invoke_subagent")).toBe(true);
      expect(engine.isToolPermitted(agentId, role, "msg:send")).toBe(true);

      // Advance to Strike 2
      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_CODE_EDIT",
        attemptedAction: "write",
      });
      engine.interceptAction({
        agentId,
        role,
        actionType: "DIRECT_TEST_RUN",
        attemptedAction: "test",
      });

      // Strike 2: revoked tools forbidden, delegation/supervisory tools allowed
      for (const tool of DEFAULT_REVOKED_TOOLS) {
        expect(engine.isToolPermitted(agentId, role, tool)).toBe(false);
      }
      expect(engine.isToolPermitted(agentId, role, "invoke_subagent")).toBe(true);
      expect(engine.isToolPermitted(agentId, role, "msg:send")).toBe(true);
      expect(engine.isToolPermitted(agentId, role, "dag")).toBe(true);
      expect(engine.isToolPermitted(agentId, role, "doctor")).toBe(true);
      expect(engine.isToolPermitted(agentId, role, "view_file")).toBe(true);
      expect(engine.isToolPermitted(agentId, role, "list_dir")).toBe(true);

      // Advance to Strike 3 (Terminated)
      engine.interceptAction({
        agentId,
        role,
        actionType: "BYPASS_DELEGATION",
        attemptedAction: "claim",
      });

      // Strike 3: terminated agent is denied ALL tools
      expect(engine.isToolPermitted(agentId, role, "write_to_file")).toBe(false);
      expect(engine.isToolPermitted(agentId, role, "invoke_subagent")).toBe(false);
      expect(engine.isToolPermitted(agentId, role, "msg:send")).toBe(false);
      expect(engine.isToolPermitted(agentId, role, "view_file")).toBe(false);
    });

    it("verifies isRevokedTool and isAllowedSupervisoryTool constants and checks", () => {
      const engine = new MechanicalContainmentEngine();

      expect(engine.isRevokedTool("write_to_file")).toBe(true);
      expect(engine.isRevokedTool("replace_file_content")).toBe(true);
      expect(engine.isRevokedTool("run_command")).toBe(true);
      expect(engine.isRevokedTool("mcp_server_write_file")).toBe(true);

      expect(engine.isAllowedSupervisoryTool("invoke_subagent")).toBe(true);
      expect(engine.isAllowedSupervisoryTool("msg:send")).toBe(true);
      expect(engine.isAllowedSupervisoryTool("dag")).toBe(true);
      expect(engine.isAllowedSupervisoryTool("doctor")).toBe(true);
      expect(ALLOWED_SUPERVISORY_TOOLS).toContain("invoke_subagent");
    });
  });
});
