import { taskAddCommand, executeTaskAdd } from "./task-add.ts";
import { taskListCommand, executeTaskList } from "./task-list.ts";
import { taskLeaseCommand, executeTaskLease } from "./task-lease.ts";
import { taskCompleteCommand, executeTaskComplete } from "./task-complete.ts";
import { failTask, pruneTaskQueue } from "../../task/queue/index.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export {
  taskAddCommand,
  executeTaskAdd,
  taskListCommand,
  executeTaskList,
  taskLeaseCommand,
  executeTaskLease,
  taskCompleteCommand,
  executeTaskComplete,
};

export function taskFailCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const taskId =
    textFlag(flags, "task", false) ??
    textFlag(flags, "task-id", false) ??
    textFlag(flags, "id", true)!;
  const rawMessage =
    textFlag(flags, "message", false) ??
    textFlag(flags, "error", false) ??
    textFlag(flags, "reason", false);
  const errorMessage = rawMessage !== undefined ? rawMessage : "Task execution failed";
  const agentId = textFlag(flags, "agent", false) ?? textFlag(flags, "agent-id", false);
  const leaseToken = textFlag(flags, "lease-token", false) ?? textFlag(flags, "token", false);
  const canRetry =
    flags["can-retry"] === "true" || boolFlag(flags, "can-retry")
      ? true
      : flags["can-retry"] === "false"
        ? false
        : undefined;
  const escalate = boolFlag(flags, "escalate");
  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const result = failTask({
    taskId,
    errorMessage,
    agentId,
    leaseToken,
    canRetry,
    escalateOnMaxRetries: escalate,
    customPath: queuePath,
  });

  return {
    task: result.task,
    retried: result.retried,
    affectedDependents: result.affectedDependents,
    escalated: result.escalated,
  };
}

export function taskPruneCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const completedTasksPath =
    textFlag(flags, "completed-tasks-path", false) ?? textFlag(flags, "archive-path", false);
  const autoArchive =
    flags["auto-archive"] === "false" || boolFlag(flags, "no-auto-archive") ? false : true;
  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const result = pruneTaskQueue({
    customPath: queuePath,
    completedTasksPath,
    autoArchive,
  });

  return {
    prunedCount: result.prunedCount,
    remainingCount: result.remainingCount,
    archivedCount: result.archivedCount,
  };
}
