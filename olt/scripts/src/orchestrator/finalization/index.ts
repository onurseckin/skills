/**
 * Explicit named facade for the finalization and release domain.
 */

export type {
  BackgroundFinalizationOptions,
  BackgroundFinalizationResult,
  FinalizationStepName,
  FinalizationStepResult,
  FinalizationStepStatus,
  GitRunner,
  GitRunnerResult,
  SupervisionLoopRunnerOptions,
  SupervisionLoopSummary,
  SyncRunner,
  ZeroMainThreadSpilloverVerification,
} from "./types.ts";

export { defaultGitRunner, defaultSyncRunner, boundedEvidenceCause } from "./runners.ts";
export {
  assertZeroMainThreadSpillover,
  enforceZeroMainThreadSpillover,
} from "./spillover-guard.ts";
export {
  executeBackgroundFinalization,
  formatBackgroundFinalizationBrief,
} from "./background-finalize.ts";
export {
  planSupervisionLoopRecycle,
  SupervisionLoopRunner,
  transitionSupervisionLoopToDiscovery,
} from "./supervision-loop-runner.ts";
