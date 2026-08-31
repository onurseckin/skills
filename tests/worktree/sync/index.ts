/**
 * Domain Worktree Sync & Provisioning Facade.
 */
export {
  createDomainLedger,
  provisionDomainWorktree,
  commitAndPushDomainSubphase,
  syncDomainToGlobal,
  syncGlobalToDomain,
  synchronizeAllDomains,
  assertDomainIsolation,
  isDomainSyncEligible,
  recordDomainCommit,
  recordDomainSync,
  recordGlobalSync,
  validateDomainIsolation,
  type DomainCommitRecord,
  type DomainLedgerState,
  type DomainSyncResult,
  type GlobalSyncSummary,
  type ProvisionWorktreeOptions,
  type ProvisionWorktreeResult,
} from "../../../olt/scripts/src/engine/worktree/domain-sync.ts";
