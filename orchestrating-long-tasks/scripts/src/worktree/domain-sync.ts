import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { transact } from "../store/index.ts";
import {
  addWorktree,
  addWorktreeForBranch,
  commitChangedLines,
  diffStat,
  headSha,
  mergeBranch,
  rebaseOnto,
  removeWorktree,
  runGit,
  stageAndCommit,
  type GitRunner,
} from "../workflow/worktree/git-ops.ts";
import {
  assertNonDestructiveWriteScope,
  assertZeroDestructiveGit,
  isPathInWriteScope,
} from "./zero-destructive-policy.ts";

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

function toPathspec(scope: string): string {
  if (scope.endsWith("/**")) {
    const directory = scope.slice(0, -3);
    return directory === "" ? "." : directory;
  }
  if (scope.includes("*")) return `:(glob)${scope}`;
  return scope;
}

function buildSubject(commitType: string, domain: string, label: string): string {
  const prefix = `${commitType}(${domain}): `;
  const budget = 70 - prefix.length;
  const description = label.length > budget ? `${label.slice(0, Math.max(0, budget - 1))}…` : label;
  return `${prefix}${description}`;
}

export function createDomainLedger(
  harnessBranch: string,
  baseSha: string,
  root: string,
  baseBranch?: string,
): DomainLedgerState {
  if (!harnessBranch || harnessBranch.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "harnessBranch cannot be empty");
  }
  if (!baseSha || baseSha.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "baseSha cannot be empty");
  }
  if (!root || root.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "root directory cannot be empty");
  }
  return {
    harnessBranch,
    baseSha,
    ...(baseBranch ? { baseBranch } : {}),
    root,
    domains: {},
    commits: [],
    syncHistory: [],
  };
}

export function provisionDomainWorktree(
  repoRoot: string,
  ledger: DomainLedgerState,
  domain: string,
  runId: string,
  runner: GitRunner = runGit,
  now: Date = new Date(),
): DomainWorktreeConfig {
  if (!domain || domain.trim() === "") {
    throw new HarnessError("INVALID_ARGUMENT", "domain name cannot be empty");
  }
  const cleanDomain = domain.trim().toLowerCase().replace(/[^a-z0-9-_]/gu, "-");
  const worktreeId = `domain-${cleanDomain}`;
  const branch = `harness--${cleanDomain}-${runId}`;
  const worktreePath = join(ledger.root, runId, cleanDomain);

  assertZeroDestructiveGit(["worktree", "add", "-b", branch, worktreePath, ledger.baseSha]);

  mkdirSync(join(ledger.root, runId), { recursive: true });
  addWorktree(repoRoot, worktreePath, branch, ledger.baseSha, runner);

  const config: DomainWorktreeConfig = {
    domain: cleanDomain,
    worktreeId,
    worktreePath,
    branch,
    baseSha: ledger.baseSha,
    headSha: ledger.baseSha,
    createdAt: now.toISOString(),
    status: "active",
    assignedTaskIds: [],
  };

  ledger.domains[cleanDomain] = config;
  return config;
}

export function commitAndPushDomainSubphase(
  input: DomainCommitPushInput,
): DomainCommitPushOutcome {
  const commitType = input.commitType ?? "feat";
  if (!CONVENTIONAL_COMMIT_TYPES.has(commitType)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `commit type '${commitType}' is not a recognised conventional-commit tag`,
    );
  }
  if (input.writeScope.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `task ${input.taskId} has no write scope to commit for domain '${input.domain}'`,
    );
  }

  if (input.modifiedPaths && input.modifiedPaths.length > 0) {
    assertNonDestructiveWriteScope(input.modifiedPaths, input.writeScope, input.taskId);
  }

  assertZeroDestructiveGit(["add", "--", ...input.writeScope.map(toPathspec)]);

  const runner = input.runner ?? runGit;
  const maxCommitLines = input.maxCommitLines ?? 400;
  const subject = buildSubject(commitType, input.domain, input.label);

  const sha = stageAndCommit(
    input.worktreePath,
    input.writeScope.map(toPathspec),
    subject,
    runner,
  );

  if (sha === null) {
    return { committed: false, pushed: false };
  }

  const changedLines = commitChangedLines(input.worktreePath, sha, runner);
  const overLimit = changedLines > maxCommitLines;
  const timestamp = (input.now ?? new Date()).toISOString();

  let pushed = false;
  if (input.pushOnCommit) {
    assertZeroDestructiveGit(["push", "origin", input.domain]);
    pushed = true;
  }

  const commit: DomainCommitRecord = {
    taskId: input.taskId,
    domain: input.domain,
    worktreeId: input.worktreeId,
    sha,
    subject,
    changedLines,
    overLimit,
    committedAt: timestamp,
    pushed,
    ...(pushed ? { pushedAt: timestamp } : {}),
  };

  return {
    committed: true,
    pushed,
    commit,
    ...(overLimit
      ? {
          warning: `Domain '${input.domain}' commit ${sha.slice(0, 12)} changed ${changedLines} lines, over the ${maxCommitLines}-line target (B22.3)`,
        }
      : {}),
  };
}

export function syncDomainToGlobal(input: SyncDomainInput): DomainSyncResult {
  const { repoRoot, runId, domain, ledger } = input;
  const runner = input.runner ?? runGit;
  const timestamp = (input.now ?? new Date()).toISOString();

  const domainConfig = ledger.domains[domain];
  if (!domainConfig) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Domain '${domain}' is not registered in the domain sync ledger`,
    );
  }

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
      `chore(domain-sync): merge ${domain} domain branch into ${ledger.harnessBranch}`,
      runner,
    );

    if (mergeOutcome) {
      const conflict: DomainSyncConflict = {
        domain,
        worktreeId: domainConfig.worktreeId,
        branch: domainConfig.branch,
        conflictingPaths: mergeOutcome.conflictPaths,
        reason: `Merge conflict on paths: ${mergeOutcome.conflictPaths.join(", ")}`,
      };

      domainConfig.status = "conflict";

      const syncResult: DomainSyncResult = {
        domain,
        synced: false,
        targetBranch: ledger.harnessBranch,
        sourceBranch: domainConfig.branch,
        commitsSynced: 0,
        conflict,
        syncedAt: timestamp,
      };

      ledger.syncHistory.push(syncResult);
      return syncResult;
    }

    const newSha = headSha(scratchPath, runner);
    domainConfig.lastSyncedSha = newSha;
    domainConfig.lastSyncedAt = timestamp;
    domainConfig.status = "synced";
    domainConfig.headSha = newSha;

    const syncResult: DomainSyncResult = {
      domain,
      synced: true,
      targetBranch: ledger.harnessBranch,
      sourceBranch: domainConfig.branch,
      commitsSynced: domainCommits.length,
      syncedSha: newSha,
      syncedAt: timestamp,
    };

    ledger.syncHistory.push(syncResult);
    return syncResult;
  } finally {
    removeWorktree(repoRoot, scratchPath, runner);
  }
}

export function syncGlobalToDomain(input: SyncGlobalToDomainInput): DomainSyncResult {
  const { domain, ledger, rebase = false } = input;
  const runner = input.runner ?? runGit;
  const timestamp = (input.now ?? new Date()).toISOString();

  const domainConfig = ledger.domains[domain];
  if (!domainConfig) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Domain '${domain}' is not registered in the domain sync ledger`,
    );
  }

  if (rebase) {
    const outcome = rebaseOnto(domainConfig.worktreePath, ledger.harnessBranch, runner);
    if (outcome) {
      const conflict: DomainSyncConflict = {
        domain,
        worktreeId: domainConfig.worktreeId,
        branch: domainConfig.branch,
        conflictingPaths: outcome.conflictPaths,
        reason: `Rebase conflict on paths: ${outcome.conflictPaths.join(", ")}`,
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
        reason: `Merge conflict on paths: ${outcome.conflictPaths.join(", ")}`,
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

  const activeDomains = Object.keys(ledger.domains);
  const syncedDomains: string[] = [];
  const failedDomains: string[] = [];
  const conflicts: DomainSyncConflict[] = [];
  let totalCommitsSynced = 0;

  for (const domain of activeDomains) {
    const result = syncDomainToGlobal({
      repoRoot,
      runId,
      domain,
      ledger,
      runner,
      now: input.now,
    });

    if (result.synced) {
      syncedDomains.push(domain);
      totalCommitsSynced += result.commitsSynced;
    } else {
      failedDomains.push(domain);
      if (result.conflict) {
        conflicts.push(result.conflict);
      }
    }
  }

  let rebased = false;
  let rebaseConflictPaths: string[] | undefined;
  const scratchPath = join(ledger.root, runId, "global-rebase");

  if (rebaseOnComplete && failedDomains.length === 0 && ledger.baseBranch) {
    mkdirSync(join(ledger.root, runId), { recursive: true });
    addWorktreeForBranch(repoRoot, scratchPath, ledger.harnessBranch, runner);
    try {
      const outcome = rebaseOnto(scratchPath, ledger.baseBranch, runner);
      if (outcome === null) {
        rebased = true;
      } else {
        rebaseConflictPaths = outcome.conflictPaths;
      }
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
    // Diffstat fallback
  } finally {
    try {
      removeWorktree(repoRoot, statWorktree, runner);
    } catch {
      // Ignored
    }
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

export function validateDomainIsolation(
  domains: readonly DomainScopeEntry[],
): DomainIsolationCheckResult {
  const conflicts: DomainScopeConflict[] = [];

  for (let i = 0; i < domains.length; i++) {
    const a = domains[i]!;
    for (let j = i + 1; j < domains.length; j++) {
      const b = domains[j]!;
      for (const scopeA of a.writeScope) {
        for (const scopeB of b.writeScope) {
          if (isPathInWriteScope(scopeA, [scopeB]) || isPathInWriteScope(scopeB, [scopeA])) {
            conflicts.push({
              domainA: a.domain,
              domainB: b.domain,
              overlappingScope: `${scopeA} <-> ${scopeB}`,
            });
          }
        }
      }
    }
  }

  return {
    isolated: conflicts.length === 0,
    conflicts,
  };
}

export function assertDomainIsolation(domains: readonly DomainScopeEntry[]): void {
  const check = validateDomainIsolation(domains);
  if (!check.isolated) {
    const details = check.conflicts
      .map((c) => `(${c.domainA} and ${c.domainB} on ${c.overlappingScope})`)
      .join(", ");
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Multi-domain write scope collision detected: ${details}. Concurrently active domains must be strictly disjoint.`,
      check.conflicts.map((c) => ({
        domainA: c.domainA,
        domainB: c.domainB,
        overlappingScope: c.overlappingScope,
      })),
      3,
      "Ensure all concurrently dispatched domains have mutually exclusive write scopes.",
    );
  }
}

export function isDomainSyncEligible(domainState: DomainWorktreeConfig): boolean {
  return domainState.status === "active" || domainState.status === "synced";
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
        throw new HarnessError("INVALID_STATE", "no domain sync ledger to record sync result against");
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
        throw new HarnessError("INVALID_STATE", "no domain sync ledger to record global sync against");
      }
      const ledger = draft.domain_sync_ledger as unknown as DomainLedgerState;
      ledger.globalSyncSummary = summary;
    },
  );
}
