import type { AgentRole } from "../contracts/packets.ts";
import type { HostProvider, MandatoryCliActionSequence } from "./types.ts";
import type { JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";

export interface CliRegistrationOptions {
  readonly runRoot: string;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly host: HostProvider;
  readonly parentAgentId?: string;
  readonly parentTaskId?: string;
  readonly taskId?: string;
  readonly modelTier?: string;
  readonly thinkingLevel?: string;
}

export function buildAgentRegisterCommand(options: CliRegistrationOptions): string {
  const parts = [
    "bun",
    "harness.ts",
    "agent:register",
    "--run",
    options.runRoot,
    "--agent",
    options.agentId,
    "--role",
    options.role,
    "--host",
    options.host,
  ];

  if (options.parentAgentId) {
    parts.push("--parent-agent", options.parentAgentId);
  }
  if (options.parentTaskId) {
    parts.push("--parent-task", options.parentTaskId);
  }
  if (options.modelTier) {
    parts.push("--model-tier", options.modelTier);
  }
  if (options.thinkingLevel) {
    parts.push("--thinking-level", options.thinkingLevel);
  }

  return parts.join(" ");
}

export function buildTaskClaimCommand(
  runRoot: string,
  taskId: string,
  agentId: string,
  role: AgentRole,
): string {
  return [
    "bun",
    "harness.ts",
    "task:claim",
    "--run",
    runRoot,
    "--task",
    taskId,
    "--agent",
    agentId,
    "--role",
    role,
  ].join(" ");
}

export function buildTaskHeartbeatCommand(
  runRoot: string,
  taskId: string,
  agentId: string,
  token = "<LEASE_TOKEN>",
): string {
  return [
    "bun",
    "harness.ts",
    "task:heartbeat",
    "--run",
    runRoot,
    "--task",
    taskId,
    "--agent",
    agentId,
    "--token",
    token,
  ].join(" ");
}

export function buildTaskSubmitCommand(
  runRoot: string,
  taskId: string,
  agentId: string,
  token = "<LEASE_TOKEN>",
  summary = "<WHAT_CHANGED_AND_VERIFICATION_RESULTS>",
): string {
  return [
    "bun",
    "harness.ts",
    "task:submit",
    "--run",
    runRoot,
    "--task",
    taskId,
    "--agent",
    agentId,
    "--token",
    token,
    "--summary",
    `"${summary}"`,
  ].join(" ");
}

export function buildMandatoryCliSequence(
  runRoot: string,
  agentId: string,
  role: AgentRole,
  taskId: string,
  host: HostProvider = "antigravity",
): MandatoryCliActionSequence {
  const registerCmd = buildAgentRegisterCommand({
    runRoot,
    agentId,
    role,
    host,
  });
  const claimCmd = buildTaskClaimCommand(runRoot, taskId, agentId, role);
  const heartbeatCmd = buildTaskHeartbeatCommand(runRoot, taskId, agentId);
  const submitCmd = buildTaskSubmitCommand(runRoot, taskId, agentId);

  return {
    agentId,
    role,
    runRoot,
    taskId,
    registerCommand: registerCmd,
    claimCommand: claimCmd,
    heartbeatCommand: heartbeatCmd,
    submitCommand: submitCmd,
  };
}

export function verifyAgentRegistration(
  state: JsonObject,
  agentId: string,
): { registered: boolean; status?: string; role?: string } {
  const agents = state.agents;
  if (!Array.isArray(agents)) {
    return { registered: false };
  }
  const match = agents.find(
    (a) => typeof a === "object" && a !== null && (a as Record<string, unknown>).id === agentId,
  ) as Record<string, unknown> | undefined;

  if (!match) {
    return { registered: false };
  }

  const result: { registered: boolean; status?: string; role?: string } = {
    registered: true,
  };
  if (typeof match.status === "string") {
    result.status = match.status;
  }
  if (typeof match.role === "string") {
    result.role = match.role;
  }
  return result;
}

export function assertAgentRegistered(state: JsonObject, agentId: string): void {
  const check = verifyAgentRegistration(state, agentId);
  if (!check.registered) {
    throw new HarnessError(
      "INVALID_STATE",
      `Mandatory CLI Action Registration failure: Agent '${agentId}' is not registered in harness memory. Execute agent:register before dispatching tasks.`,
    );
  }
}
