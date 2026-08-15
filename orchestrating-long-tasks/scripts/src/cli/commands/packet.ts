import { join } from "node:path";
import type { AgentRole } from "../../contracts/packets.ts";
import type { JsonObject } from "../../contracts/json.ts";
import type { RunState } from "../../contracts/capsule.ts";
import { readRegularFileNoFollow } from "../../core/no-follow.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { publishPacket } from "../../packets/persist-packet.ts";
import { buildPacketFromPinnedRuntime } from "../../packets/render-packet.ts";
import { loadRun, verifyIntegrity } from "../../store/index.ts";
import type { GateRuntime, TaskRecord } from "../../workflow/types.ts";
import { actorFlag, assertFlags, textFlag, type Flags } from "../options.ts";
import { loadPublishedPacketRetry } from "./packet-retry.ts";
import { evidenceSchema } from "../../packets/evidence-schema.ts";
import { initializePlannerPacket } from "../../packets/planner-packet.ts";
import { resolveRoleAsset } from "../../packets/asset-paths.ts";
import {
  recordRepositoryInspection,
  repositoryInspectionContext,
} from "../../packets/repository-inspection.ts";
import { authenticatePacketIdentity } from "../../packets/authenticate-packet.ts";

const ROLES = new Set(["completeness-critic", "implementer", "planner", "repairer", "validator"]);

function decoded(path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readRegularFileNoFollow(path));
  } catch (error) {
    throw new HarnessError("INTEGRITY", `packet instruction is unreadable: ${String(error)}`);
  }
}

function authoritativeContext(
  run: string,
  prompt: string,
  raw: RunState,
  task: TaskRecord | undefined,
  state: ReturnType<ReturnType<typeof workflowPort>["read"]>,
): JsonObject {
  const integrityIssues = verifyIntegrity(run);
  if (integrityIssues.length > 0) {
    throw new HarnessError("INTEGRITY", "cannot publish a packet from an invalid run capsule");
  }
  const requirements = state.requirements.filter((item) => task?.requirement_ids.includes(item.id));
  return {
    original_prompt: prompt,
    task_contract: task ?? null,
    mapped_requirements: requirements,
    ...repositoryInspectionContext(raw, true),
    command_evidence: state.commands,
    requirements: state.requirements,
    graph: (raw.graph ?? {}) as JsonObject,
    plan_history: planHistory(raw),
    integrity_evidence: [
      {
        status: "passed",
        issues: integrityIssues,
      },
    ],
    repository_evidence: { command_ids: [] },
  };
}

function authoritativeAttempt(
  role: AgentRole,
  task: TaskRecord | undefined,
  state: ReturnType<ReturnType<typeof workflowPort>["read"]>,
): number {
  if (role === "validator") return task?.validation?.attempt ?? 0;
  if (role === "implementer" || role === "repairer") return task?.lease?.attempt ?? 0;
  if (role === "completeness-critic") return state.completion_critic?.attempt ?? 0;
  return 1;
}

function commandIds(value: string | undefined): string[] {
  if (value === undefined) return [];
  const ids = value.split(",").map((entry) => entry.trim());
  if (ids.some((id) => id === "") || new Set(ids).size !== ids.length) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--repository-command-ids must be duplicate-free comma-separated identifiers",
    );
  }
  return ids;
}

function planHistory(raw: Record<string, unknown>): JsonObject[] {
  const prior = Array.isArray(raw.plan_history)
    ? (structuredClone(raw.plan_history) as JsonObject[])
    : [];
  const graph = raw.graph as Record<string, unknown>;
  return [...prior, { revision: graph.revision as number, status: "current" }];
}

export async function packetCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "task", "role", "agent", "token", "id", "repository-command-ids"]);
  const run = textFlag(flags, "run")!;
  const roleText = textFlag(flags, "role")!;
  if (!ROLES.has(roleText)) throw new HarnessError("INVALID_ARGUMENT", "unknown packet role");
  const role = roleText as AgentRole;
  const id = textFlag(flags, "id")!;
  const agentId = textFlag(flags, "agent")!;
  const taskId = textFlag(flags, "task", false);
  if (role === "planner") {
    if (id !== "planner-0" || taskId !== undefined || textFlag(flags, "token", false) !== undefined)
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "planner recovery requires --id planner-0 and no task or token",
      );
    const published = await initializePlannerPacket(run, agentId);
    return {
      run_root: run,
      path: published.markdownPath,
      metadata: published.packet.metadata,
    };
  }
  let loaded = loadRun(run);
  let state = workflowPort(run).read();
  const task = taskId === undefined ? undefined : state.tasks[taskId];
  if (taskId !== undefined && !task)
    throw new HarnessError("INVALID_ARGUMENT", "unknown packet task");
  const retry = loadPublishedPacketRetry(run, id, role, agentId, taskId, state);
  if (retry) {
    const published = await publishPacket(run, id, retry.packet, workflowPort(run), {
      agentId,
      attempt: retry.record.attempt,
    });
    return { run_root: run, path: published.markdownPath, metadata: retry.packet.metadata };
  }
  const token = textFlag(flags, "token", false);
  const attempt = authoritativeAttempt(role, task, state);
  authenticatePacketIdentity({
    role,
    agentId,
    ...(task === undefined ? {} : { task }),
    state,
    ...(token === undefined ? {} : { leaseToken: token }),
    attempt,
  });
  repositoryInspectionContext(loaded.state, false);
  recordRepositoryInspection(run, agentId, "current");
  loaded = loadRun(run);
  state = workflowPort(run).read();
  const graph = loaded.state.graph as Record<string, unknown>;
  const repositoryIds = commandIds(textFlag(flags, "repository-command-ids", false));
  if (role === "completeness-critic" && repositoryIds.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "completeness critic packet requires --repository-command-ids",
    );
  }
  const targetedCommands = state.gates
    .filter(
      (gate: GateRuntime) =>
        !task || gate.requirement_ids.some((id) => task.requirement_ids.includes(id)),
    )
    .map((gate) => (Array.isArray(gate.command) ? [...gate.command] : [gate.command]));
  const packet = await buildPacketFromPinnedRuntime(run, {
    runId: loaded.manifest.run_id,
    graphRevision: graph.revision as number,
    role,
    agentId,
    ...(task === undefined ? {} : { task }),
    state,
    roleInstructions: decoded(resolveRoleAsset(role)),
    authoritativeContext: {
      ...authoritativeContext(
        run,
        new TextDecoder("utf-8", { fatal: true }).decode(loaded.prompt),
        loaded.state,
        task,
        state,
      ),
      repository_evidence: { command_ids: repositoryIds },
    },
    evidenceSchema: evidenceSchema(role),
    targetedCommands,
    ...(token === undefined ? {} : { leaseToken: token }),
    attempt,
  });
  const published = await publishPacket(run, id, packet, workflowPort(run), {
    agentId,
    ...(token === undefined ? {} : { token }),
    attempt,
  });
  return { run_root: run, path: published.markdownPath, metadata: packet.metadata };
}

export function repositoryInspectionCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "actor", "phase"]);
  const phase = textFlag(flags, "phase")!;
  if (phase !== "baseline" && phase !== "current")
    throw new HarnessError("INVALID_ARGUMENT", "inspection phase must be baseline or current");
  const run = textFlag(flags, "run")!;
  return {
    run_root: run,
    inspection: recordRepositoryInspection(run, actorFlag(flags), phase),
  };
}
