import { VIRTUAL_FS_SUITES } from "./virtual-fs/index.ts";
import { LOCKS_SUITES } from "./locks/index.ts";
import { ISOLATION_SUITES } from "./isolation/index.ts";
import { RUNNER_SUITES } from "./runner/index.ts";
import { RANKING_SUITES } from "./ranking/index.ts";

export { createTestVirtualMemoryFS, VIRTUAL_FS_SUITES } from "./virtual-fs/index.ts";
export { createSampleTestSummary, LOCKS_SUITES } from "./locks/index.ts";
export { createSampleIsolationContext, ISOLATION_SUITES } from "./isolation/index.ts";
export { createSampleScopedPolicy, RUNNER_SUITES } from "./runner/index.ts";
export { createSampleRuntimeSummary, RANKING_SUITES } from "./ranking/index.ts";

export const TESTING_DOMAIN_SUITES = {
  virtualFs: VIRTUAL_FS_SUITES,
  locks: LOCKS_SUITES,
  isolation: ISOLATION_SUITES,
  runner: RUNNER_SUITES,
  ranking: RANKING_SUITES,
} as const;
