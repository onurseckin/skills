import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { addWorktree, commitChangedLines, runGit, stageAndCommit, type GitRunner } from "../../workflow/worktree/git-ops.ts";
import { createTrackWorktree } from "../../workflow/worktree/manager.ts";
import { assertNonDestructiveWriteScope, assertZeroDestructiveGit, isPathInWriteScope } from "./zero-destructive-policy.ts";
import {
  CONVENTIONAL_COMMIT_TYPES,
  recordDomainCommit,
  recordDomainSync,
  recordGlobalSync,
  type CreateHermeticWorktreeOptions,
  type DomainCommitPushInput,
  type DomainCommitPushOutcome,
  type DomainCommitRecord,
  type DomainIsolationCheckResult,
  type DomainLedgerState,
  type DomainScopeConflict,
  type DomainScopeEntry,
  type DomainWorktreeConfig,
  type WorktreeContext,
} from "./domain-sync-types.ts";

export { CONVENTIONAL_COMMIT_TYPES, recordDomainCommit, recordDomainSync, recordGlobalSync };
export type { CreateHermeticWorktreeOptions, WorktreeContext };

function resolveRepo(repoRoot?: string): string {
  if (repoRoot) return resolve(repoRoot);
  try { return findRepoRoot(process.cwd()); } catch { return resolve(process.cwd()); }
}

export async function createHermeticWorktree(
  trackId: string,
  options: CreateHermeticWorktreeOptions = {},
): Promise<WorktreeContext> {
  if (!trackId || !/^[a-zA-Z0-9_-]+$/.test(trackId)) throw new HarnessError("INVALID_ARGUMENT", `Invalid trackId: '${trackId}'`);
  const repoRoot = resolveRepo(options.repoRoot);
  const baseBranch = options.baseBranch ?? "main";
  const runner = options.runner ?? runGit;
  const record = createTrackWorktree({ trackId, repoRoot, baseBranch, runner });
  return {
    trackId,
    worktreePath: record.worktreePath,
    branch: record.branch,
    baseBranch,
    repoRoot,
    lockPath: record.lockPath,
    createdAt: record.createdAt,
  };
}

function toPathspec(scope: string): string {
  if (scope.endsWith("/**")) {
    const d = scope.slice(0, -3);
    return d === "" ? "." : d;
  }
  return scope.includes("*") ? `:(glob)${scope}` : scope;
}

function buildSubject(commitType: string, domain: string, label: string): string {
  const prefix = `${commitType}(${domain}): `;
  const budget = 70 - prefix.length;
  return `${prefix}${label.length > budget ? `${label.slice(0, Math.max(0, budget - 1))}…` : label}`;
}

export function createDomainLedger(harnessBranch: string, baseSha: string, root: string, baseBranch?: string): DomainLedgerState {
  if (!harnessBranch || harnessBranch.trim() === "") throw new HarnessError("INVALID_ARGUMENT", "harnessBranch cannot be empty");
  if (!baseSha || baseSha.trim() === "") throw new HarnessError("INVALID_ARGUMENT", "baseSha cannot be empty");
  if (!root || root.trim() === "") throw new HarnessError("INVALID_ARGUMENT", "root directory cannot be empty");
  return { harnessBranch, baseSha, ...(baseBranch ? { baseBranch } : {}), root, domains: {}, commits: [], syncHistory: [] };
}

export function provisionDomainWorktree(
  repoRoot: string,
  ledger: DomainLedgerState,
  domain: string,
  runId: string,
  runner: GitRunner = runGit,
  now: Date = new Date(),
): DomainWorktreeConfig {
  if (!domain || domain.trim() === "") throw new HarnessError("INVALID_ARGUMENT", "domain name cannot be empty");
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

export function commitAndPushDomainSubphase(input: DomainCommitPushInput): DomainCommitPushOutcome {
  const commitType = input.commitType ?? "feat";
  if (!CONVENTIONAL_COMMIT_TYPES.has(commitType)) {
    throw new HarnessError("INVALID_ARGUMENT", `commit type '${commitType}' is not a recognised conventional-commit tag`);
  }
  if (input.writeScope.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", `task ${input.taskId} has no write scope to commit for domain '${input.domain}'`);
  }
  if (input.modifiedPaths && input.modifiedPaths.length > 0) {
    assertNonDestructiveWriteScope(input.modifiedPaths, input.writeScope, input.taskId);
  }
  assertZeroDestructiveGit(["add", "--", ...input.writeScope.map(toPathspec)]);
  const runner = input.runner ?? runGit;
  const maxCommitLines = input.maxCommitLines ?? 400;
  const subject = buildSubject(commitType, input.domain, input.label);
  const sha = stageAndCommit(input.worktreePath, input.writeScope.map(toPathspec), subject, runner);
  if (sha === null) return { committed: false, pushed: false };

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
    ...(overLimit ? { warning: `Domain '${input.domain}' commit ${sha.slice(0, 12)} changed ${changedLines} lines, over the ${maxCommitLines}-line target (B22.3)` } : {}),
  };
}

export function validateDomainIsolation(domains: readonly DomainScopeEntry[]): DomainIsolationCheckResult {
  const conflicts: DomainScopeConflict[] = [];
  for (let i = 0; i < domains.length; i++) {
    const a = domains[i]!;
    for (let j = i + 1; j < domains.length; j++) {
      const b = domains[j]!;
      for (const scopeA of a.writeScope) {
        for (const scopeB of b.writeScope) {
          if (isPathInWriteScope(scopeA, [scopeB]) || isPathInWriteScope(scopeB, [scopeA])) {
            conflicts.push({ domainA: a.domain, domainB: b.domain, overlappingScope: `${scopeA} <-> ${scopeB}` });
          }
        }
      }
    }
  }
  return { isolated: conflicts.length === 0, conflicts };
}

export function assertDomainIsolation(domains: readonly DomainScopeEntry[]): void {
  const check = validateDomainIsolation(domains);
  if (!check.isolated) {
    const details = check.conflicts.map((c) => `(${c.domainA} and ${c.domainB} on ${c.overlappingScope})`).join(", ");
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Multi-domain write scope collision detected: ${details}. Concurrently active domains must be strictly disjoint.`,
      check.conflicts.map((c) => ({ domainA: c.domainA, domainB: c.domainB, overlappingScope: c.overlappingScope })),
      3,
      "Ensure all concurrently dispatched domains have mutually exclusive write scopes.",
    );
  }
}

export function isDomainSyncEligible(domainState: DomainWorktreeConfig): boolean {
  return domainState.status === "active" || domainState.status === "synced";
}
