/**
 * Runner Execution Subdomain Test Facade.
 * Explicit named exports for attempt disposition, record merging, retry exhaustion, and size bounds.
 */

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
} from "../../../olt/scripts/src/engine/runner/models/index.ts";
