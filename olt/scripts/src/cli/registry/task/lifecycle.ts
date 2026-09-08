import {
  taskAbandonCommand,
  taskClaimCommand,
  taskHeartbeatCommand,
  taskRejectCommand,
  taskReleaseCommand,
  taskReviewCommand,
  taskSubmitCommand,
  taskValidateStartCommand,
} from "../../commands/task-ops.ts";
import {
  DEFAULT_EXIT_CODES,
  optionalFlag,
  repeatableFlag,
  requiredFlag,
  type CommandHandler,
  type CommandSpec,
  type ExitCodeSpec,
  type FlagSpec,
  type FlagType,
} from "../types.ts";

export const taskCmd = (
  name: string,
  summary: string,
  description: string,
  flags: readonly FlagSpec[],
  handler: CommandHandler,
  examples: readonly string[] = [],
  exitCodes: readonly ExitCodeSpec[] = DEFAULT_EXIT_CODES,
): CommandSpec => ({
  name,
  aliases: [],
  domain: "task",
  summary,
  description,
  flags,
  readsStdin: false,
  takesRemainder: false,
  exitCodes,
  examples,
  handler,
});

export const req = (name: string, type: FlagType, desc: string): FlagSpec =>
  requiredFlag(name, type, desc);
export const opt = (
  name: string,
  type: FlagType,
  desc: string,
  def?: FlagSpec["default"],
): FlagSpec => optionalFlag(name, type, desc, def);
export const rep = (name: string, type: FlagType, desc: string): FlagSpec =>
  repeatableFlag(name, type, desc);

export const LEASE_HOLDER_FLAGS: readonly FlagSpec[] = [
  req("run", "string", "Capsule run root."),
  req("task", "string", "Leased task id."),
  req("agent", "string", "Agent holding the lease."),
  req("token", "string", "Lease bearer token."),
];

export const REVIEW_FEEDBACK_FLAGS: readonly FlagSpec[] = [
  opt("kind", "string", "Review channel kind: cognitive or adversarial."),
  opt("micro-cycle", "bool", "Record micro-cycle feedback within active lease."),
  opt("in-lease", "bool", "Alias of --micro-cycle."),
  opt("defect", "string", "Identified defect category or description."),
  opt("max-rounds", "int", "Maximum micro-cycle rounds allowed."),
];

export const taskClaimSpec: CommandSpec = taskCmd(
  "task:claim",
  "Lease a specific ready task under a declared role.",
  "Transitions the task to leased and returns the bearer token the agent must echo back.",
  [
    req("run", "string", "Capsule run root."),
    req("task", "string", "Task id to claim."),
    req("agent", "string", "Agent id receiving the lease."),
    req("role", "string", "Role contract the agent claims under."),
    opt("lease-duration", "int", "Lease length in seconds (5-86400)."),
    opt("lease-seconds", "int", "Alias of --lease-duration.", 1200),
  ],
  taskClaimCommand,
  ["bun harness.ts task:claim --run <run> --task t1 --agent w1 --role imp"],
);

export const taskHeartbeatSpec: CommandSpec = taskCmd(
  "task:heartbeat",
  "Extend a live lease so a long edit does not expire.",
  "Requires the lease token; a stale or foreign token is refused.",
  LEASE_HOLDER_FLAGS,
  taskHeartbeatCommand,
  ["bun harness.ts task:heartbeat --run <run> --task t1 --token <tok>"],
);

export const taskSubmitSpec: CommandSpec = taskCmd(
  "task:submit",
  "Submit completed task work for validation.",
  "Records the submission report, audits write-scope compliance, and moves the task to submitted.",
  [
    ...LEASE_HOLDER_FLAGS,
    opt("summary", "string", "What the agent changed."),
    rep("evidence", "string", "Recorded command id proving the work."),
    rep("files-changed", "string", "Repository-relative path the agent changed."),
    opt("report", "string", "Path to a complete submission report payload."),
    opt("no-op", "bool", "Declares the write scope legitimately needed no change."),
    opt("reason", "string", "Why --no-op is true."),
  ],
  taskSubmitCommand,
  ['bun harness.ts task:submit --run <run> --task t1 --summary "Done"'],
);

export const taskValidateStartSpec: CommandSpec = taskCmd(
  "task:validate-start",
  "Dispatch an independent validator against a submitted task.",
  "Assigns the validator and mints the validation token required by task:review.",
  [
    req("run", "string", "Capsule run root."),
    req("task", "string", "Submitted task id."),
    req("validator", "string", "Validator agent id."),
    opt("lease-duration", "int", "Validation window in seconds."),
    opt("validator-domain", "string", "B12.2 standing checklist domain."),
  ],
  taskValidateStartCommand,
  ["bun harness.ts task:validate-start --run <run> --task t1 --validator v1"],
);

export const taskReviewSpec: CommandSpec = taskCmd(
  "task:review",
  "Record a validator verdict with its gate evidence.",
  "Records pass or fail verdict along with evidence findings.",
  [
    req("run", "string", "Capsule run root."),
    req("task", "string", "Task under validation."),
    req("validator", "string", "Validator agent id."),
    req("token", "string", "Validation token."),
    req("status", "string", "pass or fail."),
    opt("summary", "string", "Verdict summary."),
    opt("severity", "string", "critical, important or minor."),
    opt("remediation", "string", "What would fix the defect."),
    opt("revalidation", "string", "How the fix is to be proven."),
    opt("evidence", "string", "Comma-separated command ids proving the verdict."),
    opt("checks", "string", "Alias of --evidence."),
    opt("finding-id", "string", "Explicit finding id for a failing verdict."),
    opt("requirement", "string", "Requirement a failing verdict binds its finding to."),
    rep("resolve", "string", "Answer an open finding."),
    rep("resolution-method", "string", "How a finding was answered."),
    opt("checklist-domain", "string", "Standing checklist domain."),
    opt("checklist-report", "string", "Path to a JSON checklist report file."),
    opt("require-semantic-depth", "bool", "Enforce strict semantic depth audits."),
    ...REVIEW_FEEDBACK_FLAGS,
  ],
  taskReviewCommand,
  ["bun harness.ts task:review --run <run> --task t1 --status pass"],
);

export const taskRejectSpec: CommandSpec = taskCmd(
  "task:reject",
  "Reject a task with a structured finding for targeted repair.",
  "Records the validator's finding and returns the task to the implementer.",
  [
    req("run", "string", "Capsule run root."),
    req("task", "string", "Task under validation."),
    req("validator", "string", "Validator agent id."),
    opt("token", "string", "Validation token."),
    req("reason", "string", "What is defective."),
    opt("severity", "string", "critical, important or minor."),
    opt("remediation", "string", "What would fix the defect."),
    opt("finding", "string", "Alias of --remediation."),
    opt("finding-id", "string", "Explicit finding id."),
    opt("evidence", "string", "Comma-separated command ids proving the defect."),
    opt("checks", "string", "Alias of --evidence."),
    opt("requirement", "string", "Requirement the finding binds to."),
    ...REVIEW_FEEDBACK_FLAGS,
  ],
  taskRejectCommand,
  ['bun harness.ts task:reject --run <run> --task t1 --reason "fail"'],
);

export const taskAbandonSpec: CommandSpec = taskCmd(
  "task:abandon",
  "Close an open attempt nobody submitted or released, on the coordinator's authority.",
  "Forced counterpart to task:release for unsticking abandoned tasks.",
  [
    req("run", "string", "Capsule run root."),
    req("task", "string", "Task with an open attempt."),
    req("actor", "string", "Who is abandoning the attempt."),
    req("reason", "string", "Why the attempt is being abandoned."),
  ],
  taskAbandonCommand,
  ['bun harness.ts task:abandon --run <run> --task t1 --reason "crash"'],
);

export const taskReleaseSpec: CommandSpec = taskCmd(
  "task:release",
  "Hand a live lease back without waiting for it to expire.",
  "The voluntary counterpart to `recover`. Requires the live lease token; the task returns to retry_ready, or to changes_requested when the released attempt was a repair. A branched task cannot be released - collect or abandon the branch first.",
  LEASE_HOLDER_FLAGS,
  taskReleaseCommand,
  ["bun harness.ts task:release --run <run> --task t1 --agent w1"],
);

export const TASK_LIFECYCLE_COMMANDS: readonly CommandSpec[] = [
  taskClaimSpec,
  taskHeartbeatSpec,
  taskSubmitSpec,
  taskValidateStartSpec,
  taskReviewSpec,
  taskRejectSpec,
  taskAbandonSpec,
  taskReleaseSpec,
];

export {
  taskAbandonCommand,
  taskClaimCommand,
  taskHeartbeatCommand,
  taskRejectCommand,
  taskReleaseCommand,
  taskReviewCommand,
  taskSubmitCommand,
  taskValidateStartCommand,
};
