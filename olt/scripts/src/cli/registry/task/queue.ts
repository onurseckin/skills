import {
  taskAddCommand,
  taskCompleteCommand,
  taskFailCommand,
  taskLeaseCommand,
  taskPruneCommand,
} from "../../commands/task-queue-ops.ts";
import { type CommandSpec, type FlagSpec } from "../types.ts";
import { opt, rep, taskCmd } from "./lifecycle.ts";

export const QUEUE_PATH_FLAGS: readonly FlagSpec[] = [
  opt("queue-path", "string", "Custom task queue file path."),
  opt("path", "string", "Alias for queue-path."),
  opt("run", "string", "Capsule run root or custom queue path."),
];

export const TRACING_FLAGS: readonly FlagSpec[] = [
  opt("trace-id", "string", "Trace correlation ID."),
  opt("span-id", "string", "Span ID."),
  opt("parent-span-id", "string", "Parent span correlation ID."),
  opt("trace-sampled", "bool", "Sampled tracing flag."),
];

export const QUEUE_OP_FLAGS: readonly FlagSpec[] = [...QUEUE_PATH_FLAGS, ...TRACING_FLAGS];

export const TASK_ID_FLAGS: readonly FlagSpec[] = [
  opt("task", "string", "Task ID."),
  opt("task-id", "string", "Alias for task ID."),
  opt("id", "string", "Alias of task ID."),
];

export const LEASE_TOKEN_FLAGS: readonly FlagSpec[] = [
  opt("lease-token", "string", "Active lease token."),
  opt("token", "string", "Alias of lease token."),
];

export const ARCHIVE_PATH_FLAGS: readonly FlagSpec[] = [
  opt("completed-tasks-path", "string", "Completed tasks archive file path."),
  opt("archive-path", "string", "Alias of completed tasks archive path."),
];

export const taskAddSpec: CommandSpec = taskCmd(
  "task:add",
  "Enqueue a task in the task queue.",
  "Appends a new task item into the task queue with dependency graph validation.",
  [
    ...TASK_ID_FLAGS,
    opt("title", "string", "Task title."),
    opt("name", "string", "Alias of task title."),
    opt("description", "string", "Task description."),
    opt("desc", "string", "Alias of task description."),
    opt("priority", "string", "Task priority (CRITICAL, HIGH, MEDIUM, LOW)."),
    opt("gate", "string", "Gate verification command."),
    rep("write-scope", "string", "Assigned writable file path."),
    rep("scope", "string", "Alias of write-scope."),
    rep("charter-goals", "string", "Charter goal identifiers."),
    rep("goals", "string", "Alias of charter-goals."),
    rep("acceptance-criteria", "string", "Acceptance criteria items."),
    rep("criteria", "string", "Alias of acceptance-criteria."),
    rep("dependencies", "string", "Task dependency IDs."),
    rep("deps", "string", "Alias of dependencies."),
    opt("source-type", "string", "Task source type."),
    opt("status", "string", "Initial task status."),
    opt("assigned-tier", "string", "Assigned execution tier."),
    opt("tier", "string", "Alias of assigned-tier."),
    opt("assigned-role", "string", "Assigned agent role."),
    opt("role", "string", "Alias of assigned-role."),
    opt("max-retries", "int", "Maximum retry count."),
    ...QUEUE_OP_FLAGS,
  ],
  taskAddCommand,
  ['bun harness.ts task:add --task task-1 --title "Implement auth" --gate "bun test"'],
);

export const taskLeaseSpec: CommandSpec = taskCmd(
  "task:lease",
  "Claim an active lease on a task in the queue.",
  "Claims an exclusive active lease on a task for an agent worker.",
  [
    ...TASK_ID_FLAGS,
    opt("agent-id", "string", "Agent ID claiming the lease."),
    opt("lease-duration", "int", "Lease duration in seconds."),
    opt("duration-seconds", "int", "Alias of lease duration."),
    opt("duration", "int", "Alias of lease duration."),
    ...QUEUE_OP_FLAGS,
  ],
  taskLeaseCommand,
  ["bun harness.ts task:lease --task task-1 --agent-id worker-1"],
);

export const taskCompleteSpec: CommandSpec = taskCmd(
  "task:complete",
  "Mark a task as completed in the queue.",
  "Records task completion, unblocks downstream dependents, and optionally archives the task.",
  [
    ...TASK_ID_FLAGS,
    opt("agent-id", "string", "Agent ID completing the task."),
    ...LEASE_TOKEN_FLAGS,
    opt("proof-summary", "string", "Summary proof of task completion."),
    opt("proof", "string", "Alias of proof summary."),
    opt("test-path", "string", "Test file path demonstrating completion."),
    opt("commit-sha", "string", "Commit SHA associated with completion."),
    opt("auto-archive", "bool", "Automatically archive completed task."),
    opt("auto-prune", "bool", "Automatically prune completed task from queue."),
    ...ARCHIVE_PATH_FLAGS,
    ...QUEUE_OP_FLAGS,
  ],
  taskCompleteCommand,
  ['bun harness.ts task:complete --task task-1 --proof-summary "All tests pass"'],
);

export const taskFailSpec: CommandSpec = taskCmd(
  "task:fail",
  "Mark a task as failed in the queue.",
  "Transitions task to failed or increments retry count if retries remain.",
  [
    ...TASK_ID_FLAGS,
    opt("message", "string", "Failure error message."),
    opt("error", "string", "Alias of error message."),
    opt("reason", "string", "Alias of error message."),
    opt("agent", "string", "Alias of agent ID."),
    opt("agent-id", "string", "Agent ID recording failure."),
    ...LEASE_TOKEN_FLAGS,
    opt("can-retry", "bool", "Allow task retry if retry count permits."),
    opt("escalate", "bool", "Escalate task upon reaching max retries."),
    ...QUEUE_PATH_FLAGS,
  ],
  taskFailCommand,
  ['bun harness.ts task:fail --task task-1 --message "Test failure"'],
);

export const taskPruneSpec: CommandSpec = taskCmd(
  "task:prune",
  "Prune completed tasks from the queue.",
  "Removes completed tasks from the active queue and archives them to completed log.",
  [
    ...ARCHIVE_PATH_FLAGS,
    opt("auto-archive", "bool", "Archive completed tasks before pruning."),
    opt("no-auto-archive", "bool", "Disable archiving completed tasks before pruning."),
    ...QUEUE_PATH_FLAGS,
  ],
  taskPruneCommand,
  ["bun harness.ts task:prune"],
);

export const TASK_QUEUE_COMMANDS: readonly CommandSpec[] = [
  taskAddSpec,
  taskLeaseSpec,
  taskCompleteSpec,
  taskFailSpec,
  taskPruneSpec,
];

export { taskAddCommand, taskCompleteCommand, taskFailCommand, taskLeaseCommand, taskPruneCommand };
