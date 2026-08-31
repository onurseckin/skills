import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertAgentRegistered,
  buildAgentRegisterCommand,
  buildMandatoryCliSequence,
  buildTaskClaimCommand,
  buildTaskHeartbeatCommand,
  buildTaskSubmitCommand,
  verifyAgentRegistration,
} from "../../../olt/scripts/src/platform/index.ts";

describe("Mandatory CLI Action Registration Protocol", () => {
  const runRoot = ".olt/capsules/test-run-platform";
  const agentId = "impl-worker-alpha";
  const taskId = "task-3";

  test("buildAgentRegisterCommand formats canonical registration shell command", () => {
    const cmd = buildAgentRegisterCommand({
      runRoot,
      agentId,
      role: "implementer",
      host: "antigravity",
      parentAgentId: "coord-1",
      parentTaskId: "task-0",
      modelTier: "m",
      thinkingLevel: "high",
    });

    expect(cmd).toBe(
      `bun harness.ts agent:register --run ${runRoot} --agent ${agentId} --role implementer --host antigravity --parent-agent coord-1 --parent-task task-0 --model-tier m --thinking-level high`,
    );
  });

  test("buildTaskClaimCommand formats task claim shell command", () => {
    const cmd = buildTaskClaimCommand(runRoot, taskId, agentId, "implementer");
    expect(cmd).toBe(
      `bun harness.ts task:claim --run ${runRoot} --task ${taskId} --agent ${agentId} --role implementer`,
    );
  });

  test("buildTaskHeartbeatCommand formats task heartbeat shell command", () => {
    const cmd = buildTaskHeartbeatCommand(runRoot, taskId, agentId, "token-123");
    expect(cmd).toBe(
      `bun harness.ts task:heartbeat --run ${runRoot} --task ${taskId} --agent ${agentId} --token token-123`,
    );
  });

  test("buildTaskSubmitCommand formats task submit shell command", () => {
    const cmd = buildTaskSubmitCommand(
      runRoot,
      taskId,
      agentId,
      "token-123",
      "Finished platform changes",
    );
    expect(cmd).toBe(
      `bun harness.ts task:submit --run ${runRoot} --task ${taskId} --agent ${agentId} --token token-123 --summary "Finished platform changes"`,
    );
  });

  test("buildMandatoryCliSequence generates complete atomic lifecycle sequence", () => {
    const seq = buildMandatoryCliSequence(runRoot, agentId, "implementer", taskId, "claude-code");
    expect(seq.agentId).toBe(agentId);
    expect(seq.taskId).toBe(taskId);
    expect(seq.registerCommand).toContain("agent:register");
    expect(seq.registerCommand).toContain("--host claude-code");
    expect(seq.claimCommand).toContain("task:claim");
    expect(seq.heartbeatCommand).toContain("task:heartbeat");
    expect(seq.submitCommand).toContain("task:submit");
  });

  test("verifyAgentRegistration verifies registered active agents in state", () => {
    const state: JsonObject = {
      agents: [
        {
          id: agentId,
          role: "implementer",
          status: "active",
          host: "antigravity",
        },
      ],
    };

    const res = verifyAgentRegistration(state, agentId);
    expect(res.registered).toBeTrue();
    expect(res.status).toBe("active");
    expect(res.role).toBe("implementer");

    expect(() => assertAgentRegistered(state, agentId)).not.toThrow();

    const missingRes = verifyAgentRegistration(state, "nonexistent-agent");
    expect(missingRes.registered).toBeFalse();

    const noAgentsRes = verifyAgentRegistration({}, "any-agent");
    expect(noAgentsRes.registered).toBeFalse();

    expect(() => assertAgentRegistered(state, "nonexistent-agent")).toThrow(HarnessError);
  });
});
