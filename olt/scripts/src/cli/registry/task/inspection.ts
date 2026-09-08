import { taskBriefCommand } from "../../commands/task-brief.ts";
import { taskCheckCommand } from "../../commands/task-check.ts";
import { taskProbeCommand } from "../../commands/task-ops.ts";
import { taskListCommand } from "../../commands/task-queue-ops.ts";
import { DEFAULT_EXIT_CODES, type CommandSpec, type ExitCodeSpec } from "../types.ts";
import { opt, rep, req, taskCmd } from "./lifecycle.ts";
import { QUEUE_PATH_FLAGS, TRACING_FLAGS } from "./queue.ts";

export const TASK_CHECK_EXIT_CODES: readonly ExitCodeSpec[] = [
  { code: 0, meaning: "SUCCESS - verification passed" },
  { code: 1, meaning: "VERIFICATION_FAILED - violations reported" },
  ...DEFAULT_EXIT_CODES.slice(1),
];

export const taskBriefSpec: CommandSpec = taskCmd(
  "task:brief",
  "Generate a zero-exploration 1-shot briefing for a task.",
  "Produces a structured briefing containing assigned write scope, target files, gate commands, recommended file-scoped test commands, acceptance criteria, and next actions.",
  [
    req("run", "string", "Capsule run root."),
    opt("task", "string", "Task id to brief."),
    opt("agent", "string", "Agent id assigned to or briefing for the task."),
    opt("role", "string", "Role under which the task is being briefed."),
    opt("all", "bool", "Include all task details in briefing."),
  ],
  taskBriefCommand,
  ["bun harness.ts task:brief --run .olt/capsules/<run-id> --task task-1"],
);

export const taskProbeSpec: CommandSpec = taskCmd(
  "task:probe",
  "Record the mandatory adversarial probe: a demand for proof, not a rejection.",
  "Each --demand becomes a probe_demand finding on the task.",
  [
    req("run", "string", "Capsule run root."),
    req("task", "string", "Task under validation."),
    req("validator", "string", "Validator agent id."),
    req("token", "string", "Validation token."),
    rep("demand", "string", "What the implementation must prove; repeat per demand."),
    opt("requirement", "string", "Requirement the demands bind to."),
    opt("revalidation", "string", "How each demand is to be answered."),
    opt("evidence", "string", "Comma-separated command ids the demands cite."),
    opt("kind", "string", "Review channel kind: cognitive or adversarial."),
  ],
  taskProbeCommand,
  ['bun harness.ts task:probe --run <run> --task t1 --demand "test"'],
);

export const taskCheckSpec: CommandSpec = taskCmd(
  "task:check",
  "Incremental verification.",
  "Check the files using AST lint audit and TypeScript typecheck pass.",
  [
    opt("run", "string", "Capsule run root."),
    opt("task", "string", "Task ID."),
    rep("file", "string", "File path."),
    opt("actor", "string", "Who is running the check."),
    opt("typecheck", "bool", "Force the typecheck pass to run."),
    opt("lint", "bool", "Run only the AST lint audit."),
    opt("format", "string", "Output format (json, text, etc.)."),
  ],
  taskCheckCommand,
  ["bun harness.ts task:check --file src/index.ts"],
  TASK_CHECK_EXIT_CODES,
);

export const taskListSpec: CommandSpec = taskCmd(
  "task:list",
  "List tasks in the task queue.",
  "Queries and lists queue items with filtering and queue statistics.",
  [
    opt("capsule", "string", "Alias for run."),
    opt("status", "string", "Filter tasks by status."),
    opt("priority", "string", "Filter tasks by priority."),
    opt("agent-id", "string", "Filter tasks by assigned agent ID."),
    opt("search", "string", "Filter tasks by substring in ID or title."),
    opt("limit", "int", "Maximum number of tasks to return."),
    opt("offset", "int", "Pagination offset."),
    opt("page", "int", "Pagination page number."),
    ...QUEUE_PATH_FLAGS,
    opt("stats", "bool", "Include queue statistics in output."),
    ...TRACING_FLAGS,
  ],
  taskListCommand,
  ["bun harness.ts task:list --status PENDING"],
);

export const TASK_INSPECTION_COMMANDS: readonly CommandSpec[] = [
  taskBriefSpec,
  taskProbeSpec,
  taskCheckSpec,
  taskListSpec,
];

export { taskBriefCommand, taskCheckCommand, taskListCommand, taskProbeCommand };
