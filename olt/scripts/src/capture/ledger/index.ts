export { GENESIS_HASH, computeEventHash, verifyEventChain } from "./hash-chain.ts";

export { assertSafeLedgerPath, resolveDefaultLedgerPath } from "./path-guard.ts";

export { CaptureEventLedger, createEventLedger, readEventLedger } from "./event-ledger.ts";

export type {
  CaptureEventRecord,
  CaptureEventType,
  EventLedgerOptions,
  EventLedgerStats,
  LedgerVerificationResult,
} from "./types.ts";
