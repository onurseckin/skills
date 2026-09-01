import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ALLOWED_SUPERVISORY_TOOLS,
  DEFAULT_REVOKED_TOOLS,
  MechanicalContainmentEngine,
} from "../../../olt/scripts/src/mind/containment/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("MechanicalContainmentEngine Core State Machine", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("tracks Strike 1 -> HALT_AND_DELEGATE", () => {
    const engine = new MechanicalContainmentEngine();
    const agentId = "coord-domain-1";
    const role = "domain-coordinator";

    const res1 = engine.interceptAction({
      agentId,
      role,
      actionType: "DIRECT_CODE_EDIT",
      attemptedAction: "write_to_file",
      targetFile: "src/domain/service.ts",
    });

    expect(res1.action).toBe("HALT_AND_DELEGATE");
    expect(res1.strikeLevel).toBe(1);
    expect(res1.blocked).toBe(true);
    expect(res1.respawnRequired).toBe(false);
    expect(res1.sanitizedState).toBe(false);
    expect(res1.message).toContain("STRIKE 1 - HALT_AND_DELEGATE");
    expect(res1.message).toContain("invoke_subagent");

    const state = engine.getAgentState(agentId);
    expect(state.strikeCount).toBe(1);
    expect(state.capabilitiesRevoked).toBe(false);
    expect(state.isTerminated).toBe(false);
    expect(state.violations).toHaveLength(1);
    expect(state.violations[0]?.violationType).toBe("DIRECT_CODE_EDIT");
  });

  test("tracks Strike 2 -> CAPABILITY_REVOCATION and strips write/exec tools", () => {
    const engine = new MechanicalContainmentEngine();
    const agentId = "orch-core-1";
    const role = "orchestrator";

    engine.interceptAction({
      agentId,
      role,
      actionType: "DIRECT_MUTATION_COMMAND",
      attemptedAction: "git commit -m 'quick fix'",
    });

    const res2 = engine.interceptAction({
      agentId,
      role,
      actionType: "DIRECT_CODE_EDIT",
      attemptedAction: "replace_file_content",
      targetFile: "src/core/main.ts",
    });

    expect(res2.action).toBe("CAPABILITY_REVOCATION");
    expect(res2.strikeLevel).toBe(2);
    expect(res2.blocked).toBe(true);
    expect(res2.respawnRequired).toBe(false);
    expect(res2.sanitizedState).toBe(false);
    expect(res2.revokedTools).toBeDefined();
    expect(res2.revokedTools).toContain("write_to_file");
    expect(res2.revokedTools).toContain("replace_file_content");
    expect(res2.revokedTools).toContain("run_command");

    const state = engine.getAgentState(agentId);
    expect(state.strikeCount).toBe(2);
    expect(state.capabilitiesRevoked).toBe(true);
    expect(state.isTerminated).toBe(false);
    expect(state.violations).toHaveLength(2);

    for (const tool of DEFAULT_REVOKED_TOOLS) {
      expect(engine.isToolPermitted(agentId, role, tool)).toBe(false);
    }
    expect(engine.isToolPermitted(agentId, role, "invoke_subagent")).toBe(true);
    expect(engine.isToolPermitted(agentId, role, "msg:send")).toBe(true);
  });

  test("tracks Strike 3 -> PERSONA_RESPAWN and terminates agent", () => {
    const engine = new MechanicalContainmentEngine();
    const agentId = "coord-domain-1";
    const role = "domain-coordinator";

    engine.interceptAction({
      agentId,
      role,
      actionType: "DIRECT_CODE_EDIT",
      attemptedAction: "write_to_file",
    });
    engine.interceptAction({
      agentId,
      role,
      actionType: "DIRECT_TEST_RUN",
      attemptedAction: "bun test",
    });

    const res3 = engine.interceptAction({
      agentId,
      role,
      actionType: "BYPASS_DELEGATION",
      attemptedAction: "task:claim",
    });

    expect(res3.action).toBe("PERSONA_RESPAWN");
    expect(res3.strikeLevel).toBe(3);
    expect(res3.blocked).toBe(true);
    expect(res3.respawnRequired).toBe(true);
    expect(res3.sanitizedState).toBe(true);
    expect(res3.message).toContain("STRIKE 3 - PERSONA_RESPAWN");

    const state = engine.getAgentState(agentId);
    expect(state.strikeCount).toBe(3);
    expect(state.isTerminated).toBe(true);

    const postTerminate = engine.interceptAction({
      agentId,
      role,
      actionType: "DIRECT_CODE_EDIT",
      attemptedAction: "touch file.ts",
    });
    expect(postTerminate.action).toBe("PERSONA_RESPAWN");
    expect(postTerminate.blocked).toBe(true);
    expect(postTerminate.strikeLevel).toBe(3);
  });

  test("enforces permitted supervisory tools for supervisors after Strike 2", () => {
    const engine = new MechanicalContainmentEngine();
    const agentId = "coord-tools-1";
    const role = "coordinator";

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

    for (const tool of ALLOWED_SUPERVISORY_TOOLS) {
      expect(engine.isToolPermitted(agentId, role, tool)).toBe(true);
    }

    expect(engine.isToolPermitted(agentId, role, "write_to_file")).toBe(false);
    expect(engine.isToolPermitted(agentId, role, "run_command")).toBe(false);
  });

  test("allows all standard tools for implementer and worker roles", () => {
    const engine = new MechanicalContainmentEngine();
    const agentId = "impl-1";
    const role = "implementer";

    expect(engine.isToolPermitted(agentId, role, "write_to_file")).toBe(true);
    expect(engine.isToolPermitted(agentId, role, "run_command")).toBe(true);
    expect(engine.isToolPermitted(agentId, role, "replace_file_content")).toBe(true);
  });

  test("resets strikes on explicit resetStrikes", () => {
    const engine = new MechanicalContainmentEngine();
    const agentId = "coord-reset";
    const role = "coordinator";

    engine.interceptAction({
      agentId,
      role,
      actionType: "DIRECT_CODE_EDIT",
      attemptedAction: "edit",
    });
    expect(engine.getAgentState(agentId).strikeCount).toBe(1);

    engine.resetStrikes(agentId);
    expect(engine.getAgentState(agentId).strikeCount).toBe(0);
    expect(engine.getAgentState(agentId).capabilitiesRevoked).toBe(false);
  });

  test("strike decay reduces strike count over time", () => {
    const engine = new MechanicalContainmentEngine({ strikeDecayMs: 50 });
    const agentId = "coord-decay";
    const role = "coordinator";

    engine.interceptAction({
      agentId,
      role,
      actionType: "DIRECT_CODE_EDIT",
      attemptedAction: "edit",
    });
    expect(engine.getAgentState(agentId).strikeCount).toBe(1);

    engine.decayStrikes(agentId, 1);
    expect(engine.getAgentState(agentId).strikeCount).toBe(0);
  });

  test("serialize and deserialize preserve exact containment state", () => {
    const engine = new MechanicalContainmentEngine();
    const agent1 = "mind-0";
    const agent2 = "coord-2";

    engine.interceptAction({
      agentId: agent1,
      role: "mind",
      actionType: "DIRECT_CODE_EDIT",
      attemptedAction: "edit_file",
    });
    engine.interceptAction({
      agentId: agent2,
      role: "coordinator",
      actionType: "DIRECT_TEST_RUN",
      attemptedAction: "bun test",
    });
    engine.interceptAction({
      agentId: agent2,
      role: "coordinator",
      actionType: "DIRECT_MUTATION_COMMAND",
      attemptedAction: "git commit",
    });

    const serialized = engine.serialize();
    const deserialized = MechanicalContainmentEngine.deserialize(serialized);

    const state1 = deserialized.getAgentState(agent1);
    expect(state1.strikeCount).toBe(1);
    expect(state1.capabilitiesRevoked).toBe(false);

    const state2 = deserialized.getAgentState(agent2);
    expect(state2.strikeCount).toBe(2);
    expect(state2.capabilitiesRevoked).toBe(true);
    expect(state2.violations).toHaveLength(2);
    expect(deserialized.isToolPermitted(agent2, "coordinator", "write_to_file")).toBe(false);
    expect(deserialized.isToolPermitted(agent2, "coordinator", "invoke_subagent")).toBe(true);
  });
});
