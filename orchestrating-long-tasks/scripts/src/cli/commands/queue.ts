import { basename, resolve } from "node:path";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { publishTaskRolePacket } from "../../packets/role-grant.ts";
import { readySet, type ReadyEntry, type ReadySetSelection } from "../../scheduler/index.ts";
import { loadRun } from "../../store/index.ts";
import { applicableGates, commandArgv } from "../../workflow/gates/gate-policy.ts";
import { claimTask } from "../../workflow/lease/claim.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import {
  formatQueueEmptyBrief,
  formatQueueListBrief,
  formatQueueNextBrief,
  formatQueuePopBrief,
  formatQueueWaveBrief,
} from "../formatters/index.ts";
import { integerFlag, textFlag, type Flags } from "../options.ts";

/** A run root is `<repo>/.capsules/<run-id>`, so repo config sits two levels above the capsule. */
function runConfig(runRoot: string): ReturnType<typeof getHarnessConfig> {
  return getHarnessConfig(resolve(runRoot, "..", ".."), runRoot);
}

/**
 * The gate a task is actually held to is the one the plan compiled for it. Composing a plausible
 * `bun test <scope>` here would hand the agent a command the harness will not accept as proof.
 */
function mandatoryGateCommands(state: WorkflowState, task: TaskRecord): string[] {
  return applicableGates(state, task).map((gate) => commandArgv(gate.command).join(" "));
}

export function queueNextCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const loaded = loadRun(run);
  const tasks = Object.values((loaded.state.tasks ?? {}) as Record<string, TaskRecord>);

  const readyTasks = tasks
    .filter((t) => t.status === "ready" || t.status === "retry_ready")
    .sort(
      (a, b) =>
        Number(b.priority ?? 50) - Number(a.priority ?? 50) ||
        Number(a.created_order ?? 0) - Number(b.created_order ?? 0),
    );

  if (readyTasks.length === 0) {
    const markdown = formatQueueEmptyBrief(basename(run));
    return { markdown, run_root: run, task: null };
  }

  const highest = readyTasks[0]!;
  const gates = mandatoryGateCommands(loaded.state as unknown as WorkflowState, highest);

  const markdown = formatQueueNextBrief({
    taskId: highest.id,
    label: (highest.label as string | undefined) ?? highest.id,
    priority: Number(highest.priority ?? 50),
    writeScope: highest.write_scope,
    gates,
    runId: basename(run),
  });

  return { markdown, run_root: run, task: highest };
}

export function queueListCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const loaded = loadRun(run);
  const allTasksMap = (loaded.state.tasks ?? {}) as Record<string, TaskRecord>;
  const tasks = Object.values(allTasksMap);

  const ready: string[] = [];
  const leased: { id: string; agent: string }[] = [];
  const validating: string[] = [];
  const blocked: { id: string; waitingOn: string[] }[] = [];
  const satisfied: string[] = [];

  for (const t of tasks) {
    if (t.status === "ready" || t.status === "retry_ready") {
      ready.push(t.id);
    } else if (t.status === "leased" || t.status === "running") {
      leased.push({ id: t.id, agent: t.lease?.agent_id ?? "unknown" });
    } else if (t.status === "validating") {
      validating.push(t.id);
    } else if (t.status === "done") {
      satisfied.push(t.id);
    } else if (t.status === "proposed") {
      const waiting = t.dependencies.filter((d) => allTasksMap[d]?.status !== "done");
      blocked.push({ id: t.id, waitingOn: waiting });
    }
  }

  const partitions = { ready, leased, validating, blocked, satisfied };
  const maxParallel = runConfig(run).default_max_parallel;
  const markdown = formatQueueListBrief(partitions, maxParallel);

  return { markdown, run_root: run, partitions, max_parallel: maxParallel };
}

/**
 * `queue:wave` is the readiness query B25 asks for: every task claimable right now — dependencies
 * done, write scope free of every active lease — ranked by critical depth. It is read-only and
 * exists for display and planning, never as an execution instruction; a coordinator keeping its
 * eligible set full re-runs this (or claims one at a time with `queue:pop` / `task:claim`) every
 * time a slot frees, and never waits for the rest of one call's answer to be dispatched.
 */
export function queueWaveCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const maxParallel =
    integerFlag(flags, "max-parallel", { minimum: 1, maximum: 64 }) ??
    runConfig(run).default_max_parallel;
  const selection: ReadySetSelection = readySet(loadRun(run).state, maxParallel);

  if (selection.entries.length === 0) {
    return {
      markdown: formatQueueEmptyBrief(basename(run)),
      run_root: run,
      wave: [],
      max_parallel: selection.max_parallel,
      topology_source: selection.topology_source,
      topology_revision: selection.topology_revision,
    };
  }

  const markdown = formatQueueWaveBrief({
    runId: basename(run),
    entries: selection.entries.map((entry: ReadyEntry) => ({
      taskId: entry.task_id,
      label: entry.label,
      priority: entry.priority,
      writeScope: entry.write_scope,
      recordedWave: entry.recorded_wave,
    })),
    maxParallel: selection.max_parallel,
    topologySource: selection.topology_source,
    topologyRevision: selection.topology_revision,
  });

  return {
    markdown,
    run_root: run,
    wave: selection.entries,
    max_parallel: selection.max_parallel,
    topology_source: selection.topology_source,
    topology_revision: selection.topology_revision,
  };
}

export async function queuePopCommand(flags: Flags): Promise<Record<string, unknown>> {
  const run = textFlag(flags, "run")!;
  const agent = textFlag(flags, "agent")!;
  const leaseSeconds =
    integerFlag(flags, "lease-duration", { minimum: 5, maximum: 86_400 }) ??
    integerFlag(flags, "lease-seconds", { minimum: 5, maximum: 86_400 });

  const loaded = loadRun(run);
  const tasks = Object.values((loaded.state.tasks ?? {}) as Record<string, TaskRecord>);

  const readyTasks = tasks
    .filter((t) => t.status === "ready" || t.status === "retry_ready")
    .sort(
      (a, b) =>
        Number(b.priority ?? 50) - Number(a.priority ?? 50) ||
        Number(a.created_order ?? 0) - Number(b.created_order ?? 0),
    );

  if (readyTasks.length === 0) {
    throw new HarnessError("INVALID_STATE", "no ready tasks available in queue to pop");
  }

  const highest = readyTasks[0]!;
  const result = claimTask(
    workflowPort(run),
    highest.id,
    agent,
    "implementer",
    leaseSeconds === undefined ? {} : { leaseSeconds },
  );

  const task = result.state.tasks[highest.id]!;
  const lease = task.lease;
  if (!lease)
    throw new HarnessError("INTEGRITY", `pop of ${highest.id} left the task without a lease`);

  // A pop is a claim by another name, so it hands over the same pair: the lease token and the
  // published contract the work is bounded by.
  const published = await publishTaskRolePacket({
    runRoot: run,
    port: workflowPort(run),
    role: "implementer",
    agentId: agent,
    attempt: lease.attempt,
    token: result.token,
    taskId: highest.id,
  });

  const markdown = formatQueuePopBrief({
    taskId: highest.id,
    agent,
    token: result.token,
    // The lease the transaction recorded, not the one the flags asked for.
    deadlineMinutes: Math.round(lease.duration_seconds / 60),
    expiresAt: lease.expires_at,
    writeScope: task.write_scope,
    gates: mandatoryGateCommands(result.state as unknown as WorkflowState, task),
  });

  return {
    markdown,
    run_root: run,
    token: result.token,
    task,
    packet_id: published.record.id,
    packet_path: published.markdownPath,
    role_contract_sha256: published.packet.metadata.role_contract_sha256,
  };
}
