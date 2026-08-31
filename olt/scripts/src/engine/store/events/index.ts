export {
  CommittedWithRecoveryPendingError,
  TRANSACTION_MARKER_FILE,
  appendProjectionEvent,
  clearTransactionMarker,
  isCommittedWithRecoveryPending,
  readTransactionMarker,
  transactionRecoveryStatus,
  type AppendProjectionDependencies,
  type TransactionMarker,
  type TransactionPhase,
} from "./event-append.ts";

export { streamEventLines, type EventLine } from "./event-lines.ts";

export { validateEventChain, type ChainResult } from "./event-stream.ts";

export {
  exactInteger,
  validateProjection,
  validateProjectionField,
  validateProjectionPatch,
} from "./event-validation.ts";

export {
  TRANSACTION_SCHEMA,
  TRANSACTION_VERSION,
  assertMarkerPath,
  markerIsValid,
  markerPath,
  writeTransactionMarker,
} from "./transaction-marker.ts";

export {
  transact,
  transactIdempotent,
  type IdempotentTransactionIdentity,
  type IdempotentTransactionResult,
} from "./transaction.ts";
