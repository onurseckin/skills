import {
  expandExternalPromptToPlan,
  runAutonomousDualIntakeCycle,
  synthesizeAutonomousTasks,
  type AutonomousDualIntakeResult,
  type SmartTaskPlan,
  type SmartTaskSynthesisResult,
} from "../../mind/smart-task-manager.ts";
import {
  claimTaskLease,
  completeTask,
  enqueueTasksBatch,
  failTask,
  getQueueStats,
  listTaskQueue,
  popNextEligibleTask,
  reclaimExpiredLeases,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStats,
  type TaskQueueStatus,
} from "../../mind/task-queue.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface SmartTaskSynthesizeResult {
  readonly markdown: string;
  readonly mode: "feedback_intake" | "self_evolution" | "external_intake" | "queue_active";
  readonly tasksCount: number;
  readonly tasks: readonly SmartTaskPlan[];
  readonly [key: string]: unknown;
}

export interface SmartTaskIngestResult {
  readonly markdown: string;
  readonly task: SmartTaskPlan;
  readonly [key: string]: unknown;
}

export interface SmartTaskQueueListResult {
  readonly markdown: string;
  readonly count: number;
  readonly stats: TaskQueueStats;
  readonly tasks: readonly TaskQueueItem[];
  readonly [key: string]: unknown;
}

export interface SmartTaskQueuePopResult {
  readonly markdown: string;
  readonly task: TaskQueueItem | null;
  readonly leaseToken: string | null;
  readonly [key: string]: unknown;
}

export interface SmartTaskQueueCompleteResult {
  readonly markdown: string;
  readonly completedTask: TaskQueueItem;
  readonly unblockedTasksCount: number;
  readonly unblockedTasks: readonly TaskQueueItem[];
  readonly [key: string]: unknown;
}

export interface SmartTaskQueueFailResult {
  readonly markdown: string;
  readonly task: TaskQueueItem;
  readonly retried: boolean;
  readonly affectedDependents: readonly string[];
  readonly [key: string]: unknown;
}

export interface SmartTaskQueueReclaimResult {
  readonly markdown: string;
  readonly reclaimedCount: number;
  readonly tasks: readonly TaskQueueItem[];
  readonly [key: string]: unknown;
}

export interface SmartTaskCycleResult {
  readonly markdown: string;
  readonly result: AutonomousDualIntakeResult;
  readonly [key: string]: unknown;
}

export function smartTaskSynthesizeCommand(
  flags: Flags,
  _context?: CommandContext,
): SmartTaskSynthesizeResult {
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const queuePath = textFlag(flags, "queue-file", false);
  const maxTasks = integerFlag(flags, "max-tasks", { minimum: 1 }) ?? 5;
  const goal = textFlag(flags, "goal", false);
  const charterGoals = goal ? [goal.trim()] : undefined;
  const autoEnqueue = boolFlag(flags, "auto-enqueue");

  const result: SmartTaskSynthesisResult = synthesizeAutonomousTasks({
    ...(capsulesDir ? { capsulesDir } : {}),
    ...(queuePath ? { queuePath } : {}),
    maxTasks,
    ...(charterGoals ? { charterGoals } : {}),
    autoEnqueue,
  });

  const lines: string[] = [
    `### Smart Task Autonomous Synthesizer [${result.mode.toUpperCase()}]`,
    `- **Summary**: ${result.summary}`,
    `- **Source Items Evaluated**: ${result.source_items_count}`,
    `- **Generated Tasks**: ${result.tasks.length}`,
    ...(result.enqueued_count !== undefined ? [`- **Enqueued to State Queue**: ${result.enqueued_count}`] : []),
  ];

  if (result.tasks.length > 0) {
    lines.push("");
    lines.push("| Task ID | Label | Write Scope | Gate |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const t of result.tasks) {
      const scopeSummary = t.write_scope.join(", ");
      lines.push(`| \`${t.id}\` | ${t.label} | \`${scopeSummary.length > 40 ? scopeSummary.slice(0, 37) + "..." : scopeSummary}\` | \`${t.gate}\` |`);
    }
  }

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    mode: result.mode,
    tasksCount: result.tasks.length,
    tasks: result.tasks,
  };
}

export function smartTaskIngestCommand(
  flags: Flags,
  _context?: CommandContext,
): SmartTaskIngestResult {
  const prompt = textFlag(flags, "prompt", true)!;
  const id = textFlag(flags, "id", false);
  const goal = textFlag(flags, "goal", false);
  const queuePath = textFlag(flags, "queue-file", false);
  const autoEnqueue = boolFlag(flags, "auto-enqueue");

  const plan = expandExternalPromptToPlan(prompt, {
    ...(id ? { baseId: id.trim() } : {}),
    ...(goal ? { charterGoals: [goal.trim()] } : {}),
  });

  if (autoEnqueue) {
    enqueueTasksBatch(
      [
        {
          id: plan.id,
          title: plan.label,
          description: plan.rationale,
          priority: plan.priority ?? "HIGH",
          write_scope: plan.write_scope,
          gate: plan.gate,
          charter_goals: plan.charter_goals,
          acceptance_criteria: plan.acceptance_criteria,
          dependencies: plan.dependencies,
          source_type: "external_intake",
        },
      ],
      queuePath,
    );
  }

  const lines: string[] = [
    `### External Prompt Ingested & Plan Enhanced`,
    `- **Task ID**: \`${plan.id}\``,
    `- **Label**: ${plan.label}`,
    `- **Write Scope**: \`${plan.write_scope.join(", ")}\``,
    `- **Gate**: \`${plan.gate}\``,
    `- **Rationale**: ${plan.rationale}`,
    ...(autoEnqueue ? ["- **Enqueued**: true"] : []),
  ];

  const markdown = enforceLineLimit(lines.join("\n"), 25);

  return {
    markdown,
    task: plan,
  };
}

export function smartTaskQueueListCommand(
  flags: Flags,
  _context?: CommandContext,
): SmartTaskQueueListResult {
  const queuePath = textFlag(flags, "queue-file", false);
  const statusFilter = textFlag(flags, "status", false)?.toUpperCase() as TaskQueueStatus | undefined;
  const priorityFilter = textFlag(flags, "priority", false)?.toUpperCase() as TaskPriority | undefined;
  const limit = integerFlag(flags, "limit", { minimum: 1 }) ?? 20;

  const tasks = listTaskQueue({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(priorityFilter ? { priority: priorityFilter } : {}),
    ...(queuePath ? { customPath: queuePath } : {}),
    limit,
  });

  const stats = getQueueStats(queuePath);

  const lines: string[] = [
    "### Stateful Task Queue Engine",
    `- **Total Tasks**: ${stats.total}`,
    `- **Status Breakdown**: Pending: ${stats.pending} | In-Progress: ${stats.in_progress} | Blocked: ${stats.blocked} | Completed: ${stats.completed} | Failed: ${stats.failed}`,
    `- **Active Leases**: ${stats.active_leases} | **Expired Leases**: ${stats.expired_leases}`,
    `- **Displaying**: ${tasks.length} items (limit: ${limit})`,
  ];

  if (tasks.length > 0) {
    lines.push("");
    lines.push("| ID | Priority | Status | Blocked By | Lease Agent | Title |");
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
    for (const t of tasks) {
      const blocked = t.blocked_by.length > 0 ? t.blocked_by.join(",") : "-";
      const agent = t.lease?.agent_id ?? "-";
      lines.push(`| \`${t.id}\` | ${t.priority} | ${t.status} | ${blocked} | ${agent} | ${t.title} |`);
    }
  } else {
    lines.push("");
    lines.push("_No tasks matching the current filter._");
  }

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    count: tasks.length,
    stats,
    tasks,
  };
}

export function smartTaskQueuePopCommand(
  flags: Flags,
  _context?: CommandContext,
): SmartTaskQueuePopResult {
  const agentId = textFlag(flags, "agent", true)!;
  const queuePath = textFlag(flags, "queue-file", false);
  const durationSeconds = integerFlag(flags, "lease-duration", { minimum: 10 });

  const popped = popNextEligibleTask({
    agentId: agentId.trim(),
    ...(durationSeconds ? { durationSeconds } : {}),
    ...(queuePath ? { customPath: queuePath } : {}),
  });

  if (!popped) {
    const markdown = enforceLineLimit(
      `### Smart Task Queue Pop\n- **Agent**: \`${agentId}\`\n- **Status**: No eligible ready tasks in queue to pop.`,
      10,
    );
    return {
      markdown,
      task: null,
      leaseToken: null,
    };
  }

  const { task, leaseToken } = popped;
  const lines: string[] = [
    `### Smart Task Popped & Leased: \`${task.id}\``,
    `- **Agent**: \`${agentId}\``,
    `- **Priority**: ${task.priority}`,
    `- **Lease Token**: \`${leaseToken}\``,
    `- **Expires At**: \`${task.lease?.expires_at}\``,
    `- **Write Scope**: \`${task.write_scope.join(", ")}\``,
    `- **Gate**: \`${task.gate}\``,
  ];

  const markdown = enforceLineLimit(lines.join("\n"), 25);

  return {
    markdown,
    task,
    leaseToken,
  };
}

export function smartTaskQueueCompleteCommand(
  flags: Flags,
  _context?: CommandContext,
): SmartTaskQueueCompleteResult {
  const taskId = textFlag(flags, "id", true)!;
  const agentId = textFlag(flags, "agent", false);
  const leaseToken = textFlag(flags, "lease-token", false);
  const queuePath = textFlag(flags, "queue-file", false);

  const result = completeTask({
    taskId: taskId.trim(),
    ...(agentId ? { agentId: agentId.trim() } : {}),
    ...(leaseToken ? { leaseToken: leaseToken.trim() } : {}),
    ...(queuePath ? { customPath: queuePath } : {}),
  });

  const lines: string[] = [
    `### Task Completed: \`${result.completedTask.id}\``,
    `- **Title**: ${result.completedTask.title}`,
    `- **Completed At**: \`${result.completedTask.completed_at}\``,
    `- **Unblocked Dependent Tasks**: ${result.unblockedTasks.length}`,
  ];

  if (result.unblockedTasks.length > 0) {
    lines.push("");
    lines.push("| Unblocked Task ID | Priority | Title |");
    lines.push("| :--- | :--- | :--- |");
    for (const u of result.unblockedTasks) {
      lines.push(`| \`${u.id}\` | ${u.priority} | ${u.title} |`);
    }
  }

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    completedTask: result.completedTask,
    unblockedTasksCount: result.unblockedTasks.length,
    unblockedTasks: result.unblockedTasks,
  };
}

export function smartTaskQueueFailCommand(
  flags: Flags,
  _context?: CommandContext,
): SmartTaskQueueFailResult {
  const taskId = textFlag(flags, "id", true)!;
  const errorMessage = textFlag(flags, "error", true)!;
  const agentId = textFlag(flags, "agent", false);
  const leaseToken = textFlag(flags, "lease-token", false);
  const canRetry = boolFlag(flags, "can-retry");
  const queuePath = textFlag(flags, "queue-file", false);

  const result = failTask({
    taskId: taskId.trim(),
    errorMessage: errorMessage.trim(),
    ...(agentId ? { agentId: agentId.trim() } : {}),
    ...(leaseToken ? { leaseToken: leaseToken.trim() } : {}),
    canRetry,
    ...(queuePath ? { customPath: queuePath } : {}),
  });

  const lines: string[] = [
    `### Task Failure Recorded: \`${result.task.id}\``,
    `- **Status**: ${result.task.status}`,
    `- **Retried**: ${result.retried ? "true (reset to PENDING)" : "false (permanently FAILED)"}`,
    `- **Retry Count**: ${result.task.retry_count} / ${result.task.max_retries}`,
    `- **Error Note**: ${result.task.error_message}`,
    `- **Affected Dependent Tasks**: ${result.affectedDependents.length}`,
  ];

  const markdown = enforceLineLimit(lines.join("\n"), 25);

  return {
    markdown,
    task: result.task,
    retried: result.retried,
    affectedDependents: result.affectedDependents,
  };
}

export function smartTaskQueueReclaimCommand(
  flags: Flags,
  _context?: CommandContext,
): SmartTaskQueueReclaimResult {
  const queuePath = textFlag(flags, "queue-file", false);

  const result = reclaimExpiredLeases({
    ...(queuePath ? { customPath: queuePath } : {}),
  });

  const lines: string[] = [
    "### Expired Lease Reclaim Engine",
    `- **Reclaimed Leases**: ${result.reclaimedCount}`,
  ];

  if (result.tasks.length > 0) {
    lines.push("");
    lines.push("| Reclaimed Task ID | Status | Retry Count | Error / Reason |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const t of result.tasks) {
      lines.push(`| \`${t.id}\` | ${t.status} | ${t.retry_count}/${t.max_retries} | ${t.error_message ?? "-"} |`);
    }
  }

  const markdown = enforceLineLimit(lines.join("\n"), 25);

  return {
    markdown,
    reclaimedCount: result.reclaimedCount,
    tasks: result.tasks,
  };
}

export function smartTaskCycleCommand(
  flags: Flags,
  _context?: CommandContext,
): SmartTaskCycleResult {
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const queuePath = textFlag(flags, "queue-file", false);
  const maxTasks = integerFlag(flags, "max-tasks", { minimum: 1 });

  const result: AutonomousDualIntakeResult = runAutonomousDualIntakeCycle({
    ...(capsulesDir ? { capsulesDir } : {}),
    ...(queuePath ? { queuePath } : {}),
    ...(maxTasks ? { maxTasks } : {}),
  });

  const lines: string[] = [
    `### Autonomous Dual-Intake Cycle: ${result.mode}`,
    `- **Summary**: ${result.summary}`,
    `- **Tasks Enqueued**: ${result.enqueued_tasks.length}`,
    `- **Queue State**: Pending: ${result.queue_stats.pending} | In-Progress: ${result.queue_stats.in_progress} | Blocked: ${result.queue_stats.blocked} | Completed: ${result.queue_stats.completed}`,
  ];

  if (result.admitted_feedback_ids.length > 0) {
    lines.push(`- **Admitted Feedback Items**: ${result.admitted_feedback_ids.join(", ")}`);
  }

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    result,
  };
}
