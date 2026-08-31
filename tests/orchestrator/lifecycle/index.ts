export { createMockGitRunner, createMockSyncRunner } from "./fixture.ts";

export const LIFECYCLE_SUITES = [
  "background-finalization-lifecycle",
  "background-finalization-recycling",
  "dead-agent-detector",
  "orchestrator-yaml",
  "run-terminal",
  "station-landing",
  "watchdog",
] as const;
