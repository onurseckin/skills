import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import {
  addWorktreeForBranch,
  diffStat,
  headSha,
  mergeBranch,
  rebaseOnto,
  removeWorktree,
  runGit,
} from "../../workflow/worktree/git-ops.ts";
import type {
  DomainSyncConflict,
  DomainSyncResult,
  GlobalSyncSummary,
  SyncAllDomainsInput,
  SyncDomainInput,
  SyncGlobalToDomainInput,
} from "./domain-sync-types.ts";
import { assertZeroDestructiveGit } from "./zero-destructive-policy.ts";

export function syncDomainToGlobal(input: SyncDomainInput): DomainSyncResult {
  const { repoRoot, runId, domain, ledger } = input;
  const runner = input.runner ?? runGit;
  const timestamp = (input.now ?? new Date()).toISOString();
  const domainConfig = ledger.domains[domain];
  if (!domainConfig)
    throw new HarnessError("INVALID_ARGUMENT", `Domain '${domain}' is not registered`);

  const domainCommits = ledger.commits.filter((c) => c.domain === domain);
  if (domainCommits.length === 0) {
    return {
      domain,
      synced: true,
      targetBranch: ledger.harnessBranch,
      sourceBranch: domainConfig.branch,
      commitsSynced: 0,
      syncedSha: domainConfig.headSha,
      syncedAt: timestamp,
    };
  }

  const scratchPath = join(ledger.root, runId, "domain-sync", domain);
  mkdirSync(join(ledger.root, runId, "domain-sync"), { recursive: true });
  assertZeroDestructiveGit(["worktree", "add", scratchPath, ledger.harnessBranch]);
  addWorktreeForBranch(repoRoot, scratchPath, ledger.harnessBranch, runner);

  try {
    const mergeOutcome = mergeBranch(
      scratchPath,
      domainConfig.branch,
      `chore(domain-sync): merge ${domain} into ${ledger.harnessBranch}`,
      runner,
    );
    if (mergeOutcome) {
      const conflict: DomainSyncConflict = {
        domain,
        worktreeId: domainConfig.worktreeId,
        branch: domainConfig.branch,
        conflictingPaths: mergeOutcome.conflictPaths,
        reason: `Merge conflict on: ${mergeOutcome.conflictPaths.join(", ")}`,
      };
      domainConfig.status = "conflict";
      const res: DomainSyncResult = {
        domain,
        synced: false,
        targetBranch: ledger.harnessBranch,
        sourceBranch: domainConfig.branch,
        commitsSynced: 0,
        conflict,
        syncedAt: timestamp,
      };
      ledger.syncHistory.push(res);
      return res;
    }
    const newSha = headSha(scratchPath, runner);
    domainConfig.lastSyncedSha = newSha;
    domainConfig.lastSyncedAt = timestamp;
    domainConfig.status = "synced";
    domainConfig.headSha = newSha;
    const res: DomainSyncResult = {
      domain,
      synced: true,
      targetBranch: ledger.harnessBranch,
      sourceBranch: domainConfig.branch,
      commitsSynced: domainCommits.length,
      syncedSha: newSha,
      syncedAt: timestamp,
    };
    ledger.syncHistory.push(res);
    return res;
  } finally {
    removeWorktree(repoRoot, scratchPath, runner);
  }
}

export function syncGlobalToDomain(input: SyncGlobalToDomainInput): DomainSyncResult {
  const { domain, ledger, rebase = false } = input;
  const runner = input.runner ?? runGit;
  const timestamp = (input.now ?? new Date()).toISOString();
  const domainConfig = ledger.domains[domain];
  if (!domainConfig)
    throw new HarnessError("INVALID_ARGUMENT", `Domain '${domain}' is not registered`);

  if (rebase) {
    const outcome = rebaseOnto(domainConfig.worktreePath, ledger.harnessBranch, runner);
    if (outcome) {
      const conflict: DomainSyncConflict = {
        domain,
        worktreeId: domainConfig.worktreeId,
        branch: domainConfig.branch,
        conflictingPaths: outcome.conflictPaths,
        reason: `Rebase conflict on: ${outcome.conflictPaths.join(", ")}`,
      };
      domainConfig.status = "conflict";
      return {
        domain,
        synced: false,
        targetBranch: domainConfig.branch,
        sourceBranch: ledger.harnessBranch,
        commitsSynced: 0,
        conflict,
        syncedAt: timestamp,
      };
    }
  } else {
    const outcome = mergeBranch(
      domainConfig.worktreePath,
      ledger.harnessBranch,
      `chore(domain-sync): sync global ${ledger.harnessBranch} into ${domain}`,
      runner,
    );
    if (outcome) {
      const conflict: DomainSyncConflict = {
        domain,
        worktreeId: domainConfig.worktreeId,
        branch: domainConfig.branch,
        conflictingPaths: outcome.conflictPaths,
        reason: `Merge conflict on: ${outcome.conflictPaths.join(", ")}`,
      };
      domainConfig.status = "conflict";
      return {
        domain,
        synced: false,
        targetBranch: domainConfig.branch,
        sourceBranch: ledger.harnessBranch,
        commitsSynced: 0,
        conflict,
        syncedAt: timestamp,
      };
    }
  }
  const updatedSha = headSha(domainConfig.worktreePath, runner);
  domainConfig.headSha = updatedSha;
  domainConfig.status = "active";
  return {
    domain,
    synced: true,
    targetBranch: domainConfig.branch,
    sourceBranch: ledger.harnessBranch,
    commitsSynced: 1,
    syncedSha: updatedSha,
    syncedAt: timestamp,
  };
}

export function synchronizeAllDomains(input: SyncAllDomainsInput): GlobalSyncSummary {
  const { repoRoot, runId, ledger, rebaseOnComplete = false } = input;
  const runner = input.runner ?? runGit;
  const timestamp = (input.now ?? new Date()).toISOString();
  const syncedDomains: string[] = [];
  const failedDomains: string[] = [];
  const conflicts: DomainSyncConflict[] = [];
  let totalCommitsSynced = 0;

  for (const domain of Object.keys(ledger.domains)) {
    const result = syncDomainToGlobal({ repoRoot, runId, domain, ledger, runner, now: input.now });
    if (result.synced) {
      syncedDomains.push(domain);
      totalCommitsSynced += result.commitsSynced;
    } else {
      failedDomains.push(domain);
      if (result.conflict) conflicts.push(result.conflict);
    }
  }

  let rebased = false;
  let rebaseConflictPaths: string[] | undefined;
  if (rebaseOnComplete && failedDomains.length === 0 && ledger.baseBranch) {
    const scratchPath = join(ledger.root, runId, "global-rebase");
    mkdirSync(join(ledger.root, runId), { recursive: true });
    addWorktreeForBranch(repoRoot, scratchPath, ledger.harnessBranch, runner);
    try {
      const outcome = rebaseOnto(scratchPath, ledger.baseBranch, runner);
      if (outcome === null) rebased = true;
      else rebaseConflictPaths = outcome.conflictPaths;
    } finally {
      removeWorktree(repoRoot, scratchPath, runner);
    }
  }

  let stat = "0 files changed";
  const statWorktree = join(ledger.root, runId, "diffstat-probe");
  try {
    mkdirSync(join(ledger.root, runId), { recursive: true });
    addWorktreeForBranch(repoRoot, statWorktree, ledger.harnessBranch, runner);
    stat = diffStat(statWorktree, ledger.baseSha, "HEAD", runner);
  } catch {
  } finally {
    try {
      removeWorktree(repoRoot, statWorktree, runner);
    } catch {}
  }

  const summary: GlobalSyncSummary = {
    harnessBranch: ledger.harnessBranch,
    syncedDomains,
    failedDomains,
    totalCommitsSynced,
    conflicts,
    diffstat: stat,
    rebased,
    ...(ledger.baseBranch ? { rebaseTarget: ledger.baseBranch } : {}),
    ...(rebaseConflictPaths ? { rebaseConflictPaths } : {}),
    consolidatedAt: timestamp,
    scopeIsolated: conflicts.length === 0,
  };
  ledger.globalSyncSummary = summary;
  return summary;
}
