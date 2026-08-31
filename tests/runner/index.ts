/**
 * Lane 10: Runner Domain Root Test Facade.
 * Re-exports domain facades across all 9 subdomains:
 * - attempt/
 * - command/
 * - execution/
 * - signing/
 * - receipt/
 * - observation/
 * - process/
 * - reconciliation/
 * - telemetry/
 */

// 1. Attempt Subdomain
export {
  runAttempt,
  cleanupAfterAttemptFailure,
  finalizeSuccessfulAttempt,
  finalizeGateAttempt,
  writeSuccessfulAttemptEvidence,
  settleBounded,
  settleTrackerBeforeOutcome,
  raceWithTimeout,
} from "./attempt/index.ts";

// 2. Command Subdomain
export {
  runCommand,
  prepareCommand,
  executePreparedCommand,
  acquireMutexLock,
  isBroadScopeTest,
  createInternalCommandRunner,
  setExecutionLockDependenciesForTesting,
  commandId,
  canonicalCommandFingerprint,
  sameCommandJson,
  commandLayers,
  effectiveCommandArgv,
  type InternalCommandRunner,
  type CommandLayers,
  type ExecutionLockDependencies,
} from "./command/index.ts";

// 3. Execution Subdomain
export {
  CREATE_ATTEMPT_DISPOSITION,
  createAttemptDispositionCapabilityWithKey,
  applyAttemptRecord,
  applyAttempt,
  replaceFinalAttempt,
  updateRetryExhaustion,
  aggregateFinalAttemptIssues,
  transientFailure,
  assertCommandAttemptSize,
  assertCommandRecordSize,
  assertCommandIntentSize,
} from "./execution/index.ts";

// 4. Signing Subdomain
export {
  createCommandSigningCapability,
  captureGateEnvironment,
  captureGatePathBindings,
  type CommandSigningCapability,
} from "./signing/index.ts";

// 5. Receipt Subdomain
export {
  boundedEvidenceError,
  MAX_COMMAND_ATTEMPT_BYTES,
  MAX_COMMAND_RECORD_BYTES,
  MAX_COMMAND_INTENT_BYTES,
} from "./receipt/index.ts";

// 6. Observation Subdomain
export {
  embeddedCommandIssues,
  repositoryObservationIssues,
  commandExecutionSnapshot,
  type CommandRuntimeCapability,
} from "./observation/index.ts";

// 7. Process Subdomain
export {
  terminateProcessGroup,
  signalProcessGroup,
  readProcessIdentity,
  sameProcessIdentity,
  processSnapshot,
  ancestry,
  matchesTopology,
  type ProcessGroupInspection,
  type ProcessIdentity,
  type ProcessSnapshotEntry,
} from "./process/index.ts";

// 8. Reconciliation Subdomain
export {
  reconcileInterruptedAttempt,
  reconcilePendingRetryAttempt,
  trackDescendants,
  type AttemptReconciliationResult,
  type DescendantTracker,
} from "./reconciliation/index.ts";

// 9. Telemetry Subdomain
export {
  monitorProcess,
  activityMetadata,
  ProcessTimeoutWatchdog,
  type ProcessMonitorResult,
  type ActivityMetadata,
} from "./telemetry/index.ts";
