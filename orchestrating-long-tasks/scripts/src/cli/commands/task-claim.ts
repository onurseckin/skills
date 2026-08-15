import { HarnessError } from "../../errors/harness-error.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { loadRun } from "../../store/index.ts";
import { claimTask } from "../../workflow/lease/claim.ts";
import { heartbeat } from "../../workflow/lease/heartbeat.ts";
import { submitTask } from "../../workflow/submission/submit.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import {
  formatTaskClaimBrief,
  formatTaskHeartbeatBrief,
  formatTaskSubmitBrief,
} from "../formatters/index.ts";
import { assertFlags, integerFlag, textFlag, type Flags } from "../options.ts";
import { packetCommand } from "./packet.ts";

export async function taskClaimCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "task", "agent", "role", "lease-duration", "lease-seconds"]);
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const role = textFlag(flags, "role", false) ?? "implementer";
  const leaseSeconds =
    integerFlag(flags, "lease-duration", { minimum: 5, maximum: 86_400 }) ??
    integerFlag(flags, "lease-seconds", { minimum: 5, maximum: 86_400 });

  const result = claimTask(
    workflowPort(run),
    taskId,
    agent,
    role,
    leaseSeconds === undefined ? {} : { leaseSeconds },
  );

  const durationMin = Math.round((leaseSeconds ?? 1200) / 60);
  const task = result.state.tasks[taskId]!;
  let packetPath = `${run}/packets/${taskId}/packet.md`;
  try {
    const published = await packetCommand({
      run,
      task: taskId,
      role,
      agent,
      token: result.token,
      id: `packet-${taskId}-${agent}`,
    });
    if (typeof published.path === "string") packetPath = published.path;
  } catch {
    // Gracefully handle if already published
  }

  const markdown = formatTaskClaimBrief({
    taskId,
    agent,
    token: result.token,
    durationMinutes: durationMin,
    writeScope: task.write_scope,
    packetPath,
  });

  return { markdown, run_root: run, token: result.token, task };
}

export function taskHeartbeatCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run", "task", "agent", "token", "extend"]);
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const token = textFlag(flags, "token")!;
  const extendSeconds = integerFlag(flags, "extend", { minimum: 60, maximum: 86_400 }) ?? 1800;

  const state = heartbeat(workflowPort(run), taskId, agent, token);
  const task = state.tasks[taskId]!;
  const newDeadline = task.lease?.expires_at ?? "30m";
  const markdown = formatTaskHeartbeatBrief({
    taskId,
    agent,
    extendedMinutes: Math.round(extendSeconds / 60),
    newDeadline,
  });

  return { markdown, run_root: run, task };
}

export async function taskSubmitCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "task", "agent", "token", "summary", "evidence", "report"]);
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const agent = textFlag(flags, "agent")!;
  const token = textFlag(flags, "token")!;
  const summary = textFlag(flags, "summary", false) ?? "Task implementation completed";

  const allTasks = (loadRun(run).state.tasks ?? {}) as Record<string, TaskRecord>;
  const taskBefore = allTasks[taskId];
  if (!taskBefore) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);

  const reportPayload: Record<string, unknown> = {
    summary,
    requirement_ids: taskBefore.requirement_ids,
    files_changed: taskBefore.write_scope.length > 0 ? [taskBefore.write_scope[0]!] : ["src/index.ts"],
    checks: [{ command_id: `cmd-${taskId}-gate` }],
    evidence: [{ kind: "completion", detail: summary }],
  };

  const result = submitTask(workflowPort(run), taskId, agent, token, reportPayload);
  const task = result.state.tasks[taskId]!;
  const reportPath = `${run}/reports/${taskId}-submission.json`;

  const markdown = formatTaskSubmitBrief({
    taskId,
    agent,
    filesTouchedCount: (reportPayload.files_changed as string[]).length,
    writeScope: task.write_scope,
    reportPath,
  });

  return { markdown, run_root: run, orphaned: result.orphaned, task, report_path: reportPath };
}
