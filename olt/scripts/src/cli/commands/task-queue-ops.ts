import {
  enqueueTask,
  listTaskQueue,
  getTaskQueueStats,
  claimTaskLease,
  completeTask,
  failTask,
  pruneTaskQueue,
  type NewTaskQueueInput,
  type TaskPriority,
  type TaskSourceType,
  type TaskQueueStatus,
} from "../../task/queue/index.ts";
import {
  boolFlag,
  integerFlag,
  listFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";

export function taskAddCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const id =
    textFlag(flags, "task", false) ??
    textFlag(flags, "task-id", false) ??
    textFlag(flags, "id", false) ??
    `task-${Date.now()}`;
  const title = textFlag(flags, "title", false) ?? textFlag(flags, "name", false) ?? id;
  const description =
    textFlag(flags, "description", false) ?? textFlag(flags, "desc", false) ?? title;
  const priority = textFlag(flags, "priority", false) as TaskPriority | undefined;
  const rawGate = textFlag(flags, "gate", false);
  const gate = rawGate !== undefined ? rawGate : "bun test";
  const writeScope = listFlag(flags, "write-scope", false) ?? listFlag(flags, "scope", false) ?? [];
  const charterGoals = listFlag(flags, "charter-goals", false) ?? listFlag(flags, "goals", false);
  const acceptanceCriteria =
    listFlag(flags, "acceptance-criteria", false) ?? listFlag(flags, "criteria", false);
  const dependencies = listFlag(flags, "dependencies", false) ?? listFlag(flags, "deps", false);
  const sourceType = textFlag(flags, "source-type", false) as TaskSourceType | undefined;
  const status = textFlag(flags, "status", false) as TaskQueueStatus | undefined;
  const assignedTier = textFlag(flags, "assigned-tier", false) ?? textFlag(flags, "tier", false);
  const assignedRole = textFlag(flags, "assigned-role", false) ?? textFlag(flags, "role", false);
  const maxRetries = integerFlag(flags, "max-retries");
  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const input: NewTaskQueueInput = {
    id,
    title,
    description,
    priority,
    gate,
    write_scope: writeScope,
    charter_goals: charterGoals,
    acceptance_criteria: acceptanceCriteria,
    dependencies,
    source_type: sourceType,
    status,
    assigned_tier: assignedTier,
    assigned_role: assignedRole,
    max_retries: maxRetries,
  };

  const task = enqueueTask(input, queuePath);
  return {
    ok: true,
    task,
    id: task.id,
  };
}

export function taskListCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const status = textFlag(flags, "status", false) as TaskQueueStatus | undefined;
  const priority = textFlag(flags, "priority", false) as TaskPriority | undefined;
  const agentId = textFlag(flags, "agent", false) ?? textFlag(flags, "agent-id", false);
  const search = textFlag(flags, "search", false);
  const limit = integerFlag(flags, "limit");
  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const tasks = listTaskQueue({
    status,
    priority,
    agentId,
    search,
    limit,
    customPath: queuePath,
  });
  const stats = getTaskQueueStats(queuePath);

  return {
    tasks,
    stats,
    total: tasks.length,
  };
}

export function taskLeaseCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const taskId =
    textFlag(flags, "task", false) ??
    textFlag(flags, "task-id", false) ??
    textFlag(flags, "id", true)!;
  const rawAgent = textFlag(flags, "agent", false) ?? textFlag(flags, "agent-id", false);
  const agentId = rawAgent !== undefined ? rawAgent : "agent-worker";
  const durationSeconds =
    integerFlag(flags, "lease-duration") ??
    integerFlag(flags, "duration-seconds") ??
    integerFlag(flags, "duration");
  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const result = claimTaskLease({
    taskId,
    agentId,
    durationSeconds,
    customPath: queuePath,
  });

  return {
    task: result.task,
    leaseToken: result.leaseToken,
    token: result.leaseToken,
  };
}

export function taskCompleteCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const taskId =
    textFlag(flags, "task", false) ??
    textFlag(flags, "task-id", false) ??
    textFlag(flags, "id", true)!;
  const agentId = textFlag(flags, "agent", false) ?? textFlag(flags, "agent-id", false);
  const leaseToken = textFlag(flags, "lease-token", false) ?? textFlag(flags, "token", false);
  const proofSummary = textFlag(flags, "proof-summary", false) ?? textFlag(flags, "proof", false);
  const testPath = textFlag(flags, "test-path", false);
  const commitSha = textFlag(flags, "commit-sha", false);
  const autoArchive = boolFlag(flags, "auto-archive");
  const autoPrune = boolFlag(flags, "auto-prune");
  const completedTasksPath =
    textFlag(flags, "completed-tasks-path", false) ?? textFlag(flags, "archive-path", false);
  const queuePath =
    textFlag(flags, "queue-path", false) ??
    textFlag(flags, "path", false) ??
    textFlag(flags, "run", false);

  const result = completeTask({
    taskId,
    agentId,
    leaseToken,
    proofSummary,
    testPath,
    commitSha,
    autoArchive: autoArchive ? true : undefined,
    autoPrune: autoPrune ? true : undefined,
    completedTasksPath,
    customPath: queuePath,
  });

  return {
    task: result.completedTask,
    completedTask: result.completedTask,
    unblockedTasks: result.unblockedTasks,
    archivedRecord: result.archivedRecord,
  };
}

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
