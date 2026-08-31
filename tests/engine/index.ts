import { POLICY_SUITES } from "./policy/index.ts";
import { RUNNER_SUITES } from "./runner/index.ts";
import { SCHEDULER_SUITES } from "./scheduler/index.ts";
import { STORE_SUITES } from "./store/index.ts";
import { SYNC_SUITES } from "./sync/index.ts";

export { createTestPolicy, POLICY_SUITES } from "./policy/index.ts";
export { createTestAgentMetadata, RUNNER_SUITES } from "./runner/index.ts";
export { createTestTask, createTestRunState, SCHEDULER_SUITES } from "./scheduler/index.ts";
export { createTestDefect, createTestEventPayload, STORE_SUITES } from "./store/index.ts";
export { createTestDomainCommit, createTestDomainLedger, createTestProgressSnapshot, SYNC_SUITES } from "./sync/index.ts";

export const ENGINE_DOMAIN_SUITES = {
  policy: POLICY_SUITES,
  runner: RUNNER_SUITES,
  scheduler: SCHEDULER_SUITES,
  store: STORE_SUITES,
  sync: SYNC_SUITES,
} as const;
