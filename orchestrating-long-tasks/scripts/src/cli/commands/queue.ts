import { basename } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { loadRun } from "../../store/index.ts";
import { claimTask } from "../../workflow/lease/claim.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import {
  formatQueueEmptyBrief,
  formatQueueListBrief,
  formatQueueNextBrief,
  formatQueuePopBrief,
} from "../formatters/index.ts";
import { assertFlags, integerFlag, textFlag, type Flags } from "../options.ts";
import { packetCommand } from "./packet.ts";

export function queueNextCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run"]);
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
  const gateCmd = `bun test ${highest.write_scope.join(" ")}`;
  const packetPath = `${run}/packets/${highest.id}/packet.md`;

  const markdown = formatQueueNextBrief({
    taskId: highest.id,
    label: (highest.label as string | undefined) ?? highest.id,
    priority: Number(highest.priority ?? 50),
    writeScope: highest.write_scope,
    gateCmd,
    packetPath,
    runId: basename(run),
  });

  return { markdown, run_root: run, task: highest };
}

export function queueListCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run"]);
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
  const markdown = formatQueueListBrief(partitions);

  return { markdown, run_root: run, partitions };
}

export async function queuePopCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "agent", "lease-duration", "lease-seconds"]);
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

  const durationMin = Math.round((leaseSeconds ?? 1200) / 60);
  const task = result.state.tasks[highest.id]!;
  const gateCmd = `bun test ${highest.write_scope.join(" ")}`;
  let packetPath = `${run}/packets/${highest.id}/packet.md`;
  try {
    const published = await packetCommand({
      run,
      task: highest.id,
      role: "implementer",
      agent,
      token: result.token,
      id: `packet-${highest.id}-${agent}`,
    });
    if (typeof published.path === "string") packetPath = published.path;
  } catch {
    // Gracefully handle if already published
  }

  const markdown = formatQueuePopBrief({
    taskId: highest.id,
    agent,
    token: result.token,
    deadlineMinutes: durationMin,
    expiresAt: task.lease?.expires_at ?? "30m",
    writeScope: task.write_scope,
    gateCmd,
    packetPath,
  });

  return { markdown, run_root: run, token: result.token, task };
}
