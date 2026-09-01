export { CLI_TASK_REJECT_SUITES } from "./reject/index.ts";

export const CLI_TASK_LIFECYCLE_SUITES = [
  "gate-prove-command-core",
  "gate-prove-command-gates",
  "task-abandon-command",
  "task-assign-repairer",
  "task-claim",
  "task-heartbeat-leases",
  "task-queue-commands",
  "task-submit",
] as const;
