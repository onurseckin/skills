export { createTestAgentMetadata } from "./fixture.ts";

export const RUNNER_SUITES = [
  "runner",
  "runner-extended",
  "watchdog-remediation",
  "run-command-execution",
  "run-command-mutex",
  "run-command-preparation",
] as const;
