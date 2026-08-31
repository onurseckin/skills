export {
  recoverDiskState,
  type DiskRecoveryOptions,
  type DiskRecoveryOutcome,
} from "./disk-recovery.ts";

export { fastForwardProjection, reconstructStateAtSequence } from "./reconstruction-engine.ts";

export {
  loadLatestSnapshot,
  loadSnapshotAtSequence,
  shouldCreateSnapshot,
  writeAtomicSnapshot,
  type SnapshotRecord,
} from "./snapshot-manager.ts";

export {
  DEFAULT_SPARSE_INDEX_INTERVAL,
  SPARSE_INDEX_VERSION,
  loadSparseIndex,
  rebuildSparseIndex,
  seekEventByteOffset,
  updateSparseIndex,
  type EventSparseIndex,
} from "./sparse-index.ts";

export {
  createStateCheckpoint,
  pruneExpiredCheckpoints,
  shouldTriggerCheckpoint,
  type CheckpointMetrics,
  type CheckpointPolicy,
  type CheckpointRetentionOptions,
  type PruneCheckpointsResult,
} from "./state-checkpointer.ts";

export {
  migrateLegacyCapsules,
  relocateVestigialLedgers,
  validateEventsFileShaChain,
  validateMigratedRun,
  type MigrationResult,
  type RelocationResult,
} from "./storage-migrator.ts";

export {
  assertSafeStoragePath,
  resolveCapsulePaths,
  resolveStoragePaths,
  type CapsulePaths,
  type StoragePaths,
} from "./storage-paths.ts";

export {
  compactWalLog,
  type WalCompactionOptions,
  type WalCompactionResult,
} from "./wal-compactor.ts";
