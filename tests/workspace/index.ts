/**
 * Lane 10: Workspace Domain Root Test Facade.
 * Re-exports domain facades across all 4 subdomains:
 * - resolution/
 * - layout/
 * - isolation/
 * - engine/
 */

// 1. Resolution Subdomain
export {
  findRepoRoot,
  isInsideCapsule,
  isTestEnvironment,
  OLT_DIR_NAME,
  OLT_FILES,
  resolveCapsulesDir,
  resolveOltDir,
  resolveScratchDir,
  safeRepoPath,
  stripCapsulePath,
} from "./resolution/index.ts";

// 2. Layout Subdomain
export {
  CAPSULE_ID_PATTERN,
  CAPSULE_LAYOUT,
  checkManifest,
  CHECKPOINT_INTERVAL,
  commandLayout,
  isCheckpointSequence,
  limits,
  packetLayout,
  reportsLayout,
  RESERVED_STATE_KEYS,
  RUN_ID_PATTERN,
  SHA256_PATTERN,
  type LayoutEntry,
  type LayoutRole,
} from "./layout/index.ts";

// 3. Isolation Subdomain
export {
  isWorktreeConsolidationRecord,
  isWorktreeLedgerState,
  withRunLock,
  type RunLockOptions,
  type WorktreeAssignment,
  type WorktreeCommitRecord,
  type WorktreeConsolidationRecord,
  type WorktreeLedgerState,
  type WorktreeMergeConflict,
  type WorktreeRecord,
} from "./isolation/index.ts";
