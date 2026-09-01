/**
 * Workspace Isolation Subdomain Test Facade.
 * Explicit named exports for worktree state machines, ledger invariants, and locks.
 */

export {
  isWorktreeConsolidationRecord,
  isWorktreeLedgerState,
  type WorktreeAssignment,
  type WorktreeCommitRecord,
  type WorktreeConsolidationRecord,
  type WorktreeLedgerState,
  type WorktreeMergeConflict,
  type WorktreeRecord,
} from "../../../olt/scripts/src/core/contracts/git/worktree.ts";

export {
  withRunLock,
  type RunLockOptions,
} from "../../../olt/scripts/src/platform/process/run-lock.ts";
