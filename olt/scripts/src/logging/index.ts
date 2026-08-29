export {
  SEVERITY_WEIGHTS,
  aggregateDefectEntries,
  deduplicateDefectLog,
  mergeStatus,
  parseAndDeduplicateDefectJsonl,
  parseIsoMs,
  pickHigherSeverity,
  serializeAggregatedDefectLog,
  toAggregatedDefect,
  withinDeduplicationWindow,
} from "./dedup.ts";
export {
  compactDefectLogFile,
  readDefectLogFile,
  recordKeyedDefect,
  resolveDefectLogPath,
} from "./defect-logger.ts";
export {
  formatSafeErrorCause,
  isTrustedIntegrityError,
  throwDefectLogIntegrityError,
} from "./error.ts";
export {
  acquireExclusiveLock,
  assertCurrentDefectMutationAuthority,
  withDefectLogMutationLock,
} from "./lock.ts";
export {
  observeDefectPromotionStage,
  promoteDefectLedgerRecords,
  readPromotionJournal,
  recoverDefectPromotion,
  verifyPromotionJournal,
  writePromotionJournal,
} from "./promotion.ts";
export {
  appendDefectLedgerRecord,
  hashLedger,
  pruneDefectLedgerRecords,
  readStrictLedgerUnlocked,
  strictLedgerIntegrity,
  withDefectLedgerTransaction,
} from "./transaction.ts";
export type {
  DeduplicationStrategy,
  DefectLogOptions,
  DefectLogResult,
  DefectPromotionPersistenceStage,
  LiveDeduplicationOptions,
  StrictDefectLedgerEntry,
} from "./types.ts";
