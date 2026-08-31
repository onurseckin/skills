export { createTestTask, createTestRunState } from "./fixture.ts";

export const SCHEDULER_SUITES = [
  "scheduler",
  "scheduler-topology",
  "scheduler-core-loop",
  "scheduler-core-state",
  "scheduler-all-extended",
  "dispatch-multi-domain",
  "scheduler-tasks",
  "scheduler-tasks-advanced",
] as const;
