/**
 * Facade for background finalization, release operations, and supervision loop execution.
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
} from "./finalization/index.ts";

export {
  assertZeroMainThreadSpillover,
  boundedEvidenceCause,
  defaultGitRunner,
  defaultSyncRunner,
  enforceZeroMainThreadSpillover,
  executeBackgroundFinalization,
  formatBackgroundFinalizationBrief,
  planSupervisionLoopRecycle,
  SupervisionLoopRunner,
  transitionSupervisionLoopToDiscovery,
} from "./finalization/index.ts";
