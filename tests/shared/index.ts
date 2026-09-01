/**
 * @file index.ts
 * Root Facade for Shared domain
 */

export {
  SHARED_FIXTURES_SUITES,
  scratchRoot,
  createSandboxDir,
  legacyScratchRoot,
} from "./fixtures/index.ts";
export {
  SHARED_UTILITIES_SUITES,
  isPushTargetInert,
  SENSITIVE_PUSH_ENV_VARS,
} from "./utilities/index.ts";
export {
  SHARED_CHAINS_SUITES,
  FIXTURE_MIND_ROOT,
  FIXTURE_ORCH_ROOT,
  FIXTURE_COORD_ROOT,
  establishSupervisorChain,
} from "./chains/index.ts";

export const SHARED_DOMAINS = ["fixtures", "utilities", "chains"] as const;
