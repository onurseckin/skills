import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { transact } from "../store/index.ts";
import type { GitRunner } from "../../workflow/worktree/git-ops.ts";

export const CONVENTIONAL_COMMIT_TYPES = new Set([
  "feat",
  "fix",
  "chore",
  "docs",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "revert",
  "hotfix",
  "security",
  "deps",
  "migration",
]);

export interface WorktreeContext {
  readonly trackId: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly repoRoot: string;
  readonly lockPath?: string | undefined;
  readonly createdAt: string;
}

export interface LandingResult {
  readonly success: boolean;
  readonly trackId: string;
  readonly commitSha: string;
  readonly targetBranch: string;
  readonly rebased: boolean;
  readonly pushed: boolean;
  readonly durationMs: number;
  readonly cleaned: boolean;
  readonly tornDown: boolean;
  readonly warning?: string | undefined;
}

export interface CreateHermeticWorktreeOptions {
  readonly repoRoot?: string | undefined;
  readonly baseBranch?: string | undefined;
  readonly runner?: GitRunner | undefined;
}

export interface LandHermeticWorktreeOptions {
  readonly remote?: string | undefined;
  readonly targetBranch?: string | undefined;
  readonly commitMessage?: string | undefined;
  readonly commitType?: string | undefined;
  readonly scope?: string | undefined;
  readonly description?: string | undefined;
  readonly runner?: GitRunner | undefined;
}

export interface DomainWorktreeConfig {
  domain: string;
  worktreeId: string;
  worktreePath: string;
  branch: string;
  baseSha: string;
  headSha: string;
  createdAt: string;
  status: "active" | "syncing" | "synced" | "conflict" | "reclaimed";
  lastSyncedSha?: string | undefined;
  lastSyncedAt?: string | undefined;
  assignedTaskIds: string[];
}

export interface DomainCommitRecord {
  taskId: string;
  domain: string;
  worktreeId: string;
  sha: string;
  subject: string;
  changedLines: number;
  overLimit: boolean;
  committedAt: string;
  pushed: boolean;
  pushedAt?: string | undefined;
}

export interface DomainSyncConflict {
  domain: string;
  worktreeId: string;
  branch: string;
  conflictingPaths: string[];
  reason: string;
}

export interface DomainSyncResult {
  domain: string;
  synced: boolean;
  targetBranch: string;
  sourceBranch: string;
  commitsSynced: number;
  syncedSha?: string | undefined;
  conflict?: DomainSyncConflict | undefined;
  syncedAt: string;
}

export interface GlobalSyncSummary {
  harnessBranch: string;
  syncedDomains: string[];
  failedDomains: string[];
  totalCommitsSynced: number;
  conflicts: DomainSyncConflict[];
  diffstat: string;
  rebased: boolean;
  rebaseTarget?: string | undefined;
  rebaseConflictPaths?: string[] | undefined;
  consolidatedAt: string;
  scopeIsolated: boolean;
}

export interface DomainLedgerState {
  harnessBranch: string;
  baseSha: string;
  baseBranch?: string | undefined;
  root: string;
  domains: Record<string, DomainWorktreeConfig>;
  commits: DomainCommitRecord[];
  syncHistory: DomainSyncResult[];
  globalSyncSummary?: GlobalSyncSummary | undefined;
}

export interface DomainCommitPushInput {
  domain: string;
  taskId: string;
  worktreeId: string;
  worktreePath: string;
  writeScope: readonly string[];
  label: string;
  commitType?: string | undefined;
  maxCommitLines?: number | undefined;
  pushOnCommit?: boolean | undefined;
  modifiedPaths?: readonly string[] | undefined;
  now?: Date | undefined;
  runner?: GitRunner | undefined;
}

export interface DomainCommitPushOutcome {
  committed: boolean;
  pushed: boolean;
  commit?: DomainCommitRecord | undefined;
  warning?: string | undefined;
}

export interface SyncDomainInput {
  repoRoot: string;
  runId: string;
  domain: string;
  ledger: DomainLedgerState;
  runner?: GitRunner | undefined;
  now?: Date | undefined;
}

export interface SyncGlobalToDomainInput {
  repoRoot: string;
  domain: string;
  ledger: DomainLedgerState;
  rebase?: boolean | undefined;
  runner?: GitRunner | undefined;
  now?: Date | undefined;
}

export interface SyncAllDomainsInput {
  repoRoot: string;
  runId: string;
  ledger: DomainLedgerState;
  rebaseOnComplete?: boolean | undefined;
  runner?: GitRunner | undefined;
  now?: Date | undefined;
}

export interface DomainScopeEntry {
  domain: string;
  writeScope: readonly string[];
}

export interface DomainScopeConflict {
  domainA: string;
  domainB: string;
  overlappingScope: string;
}

export interface DomainIsolationCheckResult {
  isolated: boolean;
  conflicts: DomainScopeConflict[];
}

export function recordDomainCommit(
  runRoot: string,
  actor: string,
  domain: string,
  taskId: string,
  commit: DomainCommitRecord,
  transactFn: typeof transact = transact,
): void {
  transactFn(
    runRoot,
    actor,
    "domain-subphase-committed",
    { domain, task_id: taskId, sha: commit.sha },
    (draft) => {
      if (!isJsonObject(draft)) {
        throw new HarnessError("INVALID_STATE", "run state is not a json object");
      }
      if (!isJsonObject(draft.domain_sync_ledger)) {
        draft.domain_sync_ledger = {
          harnessBranch: "main",
          baseSha: commit.sha,
          root: ".capsules",
          domains: {},
          commits: [],
          syncHistory: [],
        };
      }
      const ledger = draft.domain_sync_ledger as unknown as DomainLedgerState;
      ledger.commits.push(commit);

      if (isJsonObject(draft.tasks) && isJsonObject(draft.tasks[taskId])) {
        draft.tasks[taskId].domain_commit = commit as unknown as JsonObject;
      }
    },
  );
}

export function recordDomainSync(
  runRoot: string,
  actor: string,
  domain: string,
  syncResult: DomainSyncResult,
  transactFn: typeof transact = transact,
): void {
  transactFn(
    runRoot,
    actor,
    "domain-synced-to-global",
    { domain, synced: syncResult.synced, sha: syncResult.syncedSha ?? null },
    (draft) => {
      if (!isJsonObject(draft)) {
        throw new HarnessError("INVALID_STATE", "run state is not a json object");
      }
      if (!isJsonObject(draft.domain_sync_ledger)) {
        throw new HarnessError(
          "INVALID_STATE",
          "no domain sync ledger to record sync result against",
        );
      }
      const ledger = draft.domain_sync_ledger as unknown as DomainLedgerState;
      ledger.syncHistory.push(syncResult);
    },
  );
}

export function recordGlobalSync(
  runRoot: string,
  actor: string,
  summary: GlobalSyncSummary,
  transactFn: typeof transact = transact,
): void {
  transactFn(
    runRoot,
    actor,
    "global-domains-consolidated",
    {
      harness_branch: summary.harnessBranch,
      synced_domains: summary.syncedDomains,
      total_commits: summary.totalCommitsSynced,
      rebased: summary.rebased,
    },
    (draft) => {
      if (!isJsonObject(draft)) {
        throw new HarnessError("INVALID_STATE", "run state is not a json object");
      }
      if (!isJsonObject(draft.domain_sync_ledger)) {
        throw new HarnessError(
          "INVALID_STATE",
          "no domain sync ledger to record global sync against",
        );
      }
      const ledger = draft.domain_sync_ledger as unknown as DomainLedgerState;
      ledger.globalSyncSummary = summary;
    },
  );
}
