export { createMockGitRunner, createMockSyncRunner, LIFECYCLE_SUITES } from "./lifecycle/index.ts";

export {
  createSampleCapsuleSpecs,
  createSampleTaskSpecs,
  CONCURRENCY_SUITES,
} from "./concurrency/index.ts";

export { createSampleStragglerTask, STRAGGLERS_SUITES } from "./stragglers/index.ts";

export { createSampleDispatchLogEvent, DISPATCH_SUITES } from "./dispatch/index.ts";

export { fakeClock, supervisedRun, SUPERVISION_SUITES } from "./supervision/index.ts";

export const ORCHESTRATOR_DOMAINS = [
  "lifecycle",
  "concurrency",
  "stragglers",
  "dispatch",
  "supervision",
] as const;
