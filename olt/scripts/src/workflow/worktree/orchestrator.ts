import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { listWorktrees } from "./discovery.ts";
import { branchExists, runGit } from "./git-ops.ts";
import { git } from "./git.ts";
import { acquireOrchestratorLock, releaseOrchestratorLock } from "./lock.ts";
import {
  assertSafeWorktreePath,
  IDENTIFIER_REGEX,
  resolveRepo,
  teardownWorktree,
} from "./teardown.ts";
import type {
  CleanupOrchestratorWorktreeOptions,
  CreateOrchestratorWorktreeOptions,
  ListWorktreesOptions,
  OrchestratorWorktreeInfo,
} from "./types.ts";

export function createOrchestratorWorktree(domain: string): string;
export function createOrchestratorWorktree(
  options: CreateOrchestratorWorktreeOptions,
): OrchestratorWorktreeInfo;
export function createOrchestratorWorktree(
  domainOrOptions: string | CreateOrchestratorWorktreeOptions,
): string | OrchestratorWorktreeInfo {
  const options: CreateOrchestratorWorktreeOptions =
    typeof domainOrOptions === "string" ? { domain: domainOrOptions } : domainOrOptions;

  const rawDomain = options.domain?.trim();
  if (!rawDomain) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing domain for orchestrator worktree.");
  }

  const cleanDomain = rawDomain.startsWith("orch-") ? rawDomain.slice(5) : rawDomain;
  if (!IDENTIFIER_REGEX.test(cleanDomain)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid orchestrator domain: '${rawDomain}'. Must contain only alphanumeric characters, dashes, or underscores.`,
    );
  }

  const worktreeId = `orch-${cleanDomain}`;
  const repo = resolveRepo(options.repoRoot);
  const worktreesRoot = join(repo, ".olt", "worktrees");
  const worktreePath = join(worktreesRoot, worktreeId);
  assertSafeWorktreePath(worktreePath, worktreesRoot);

  const lockPath = join(worktreesRoot, "locks", `${worktreeId}.lock`);
  acquireOrchestratorLock(lockPath, worktreeId, options.lockTimeoutMs);

  const runner = options.runner ?? runGit;
  const baseBranch = options.baseBranch ?? "main";
  const branch = `orch/${cleanDomain}`;
  const createdAt = (options.now ?? new Date()).toISOString();

  try {
    mkdirSync(worktreesRoot, { recursive: true });
    if (branchExists(repo, branch, runner)) {
      git(repo, ["worktree", "add", worktreePath, branch], runner);
    } else {
      git(repo, ["worktree", "add", "-b", branch, worktreePath, baseBranch], runner);
    }

    const info: OrchestratorWorktreeInfo = {
      domain: cleanDomain,
      trackId: worktreeId,
      worktreeId,
      worktreePath,
      branch,
      baseBranch,
      lockPath,
      createdAt,
      status: "active",
      tier: "orchestrator",
    };

    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(
      join(worktreePath, ".worktree-meta.json"),
      JSON.stringify(info, null, 2),
      "utf-8",
    );
    return typeof domainOrOptions === "string" ? worktreePath : info;
  } catch (error) {
    releaseOrchestratorLock(lockPath);
    throw error;
  }
}

export function destroyOrchestratorWorktree(domain: string): void;
export function destroyOrchestratorWorktree(options: CleanupOrchestratorWorktreeOptions): {
  cleaned: boolean;
  trackId: string;
  domain: string;
};
export function destroyOrchestratorWorktree(
  domainOrOptions: string | CleanupOrchestratorWorktreeOptions,
): void | { cleaned: boolean; trackId: string; domain: string } {
  const options: CleanupOrchestratorWorktreeOptions =
    typeof domainOrOptions === "string" ? { domain: domainOrOptions } : domainOrOptions;
  const rawDomain = options.domain?.trim();
  if (!rawDomain) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Missing domain for orchestrator worktree teardown.",
    );
  }
  const cleanDomain = rawDomain.startsWith("orch-") ? rawDomain.slice(5) : rawDomain;
  const worktreeId = `orch-${cleanDomain}`;
  const repo = resolveRepo(options.repoRoot);
  const worktreesRoot = join(repo, ".olt", "worktrees");
  const worktreePath = join(worktreesRoot, worktreeId);
  const lockPath = join(worktreesRoot, "locks", `${worktreeId}.lock`);
  const branch = `orch/${cleanDomain}`;

  teardownWorktree(worktreeId, {
    repo,
    worktreePath,
    branch,
    lockPath,
    deleteBranch: options.deleteBranch ?? true,
    force: options.force ?? false,
    runner: options.runner,
  });

  if (typeof domainOrOptions === "string") return;
  return { cleaned: true, trackId: worktreeId, domain: cleanDomain };
}

export function listOrchestratorWorktrees(
  options?: ListWorktreesOptions,
): readonly OrchestratorWorktreeInfo[] {
  const all = listWorktrees({ ...options, tier: "orchestrator" });
  return all.map((wt) => ({
    domain: wt.domain ?? wt.trackId.replace(/^orch-/, ""),
    trackId: wt.trackId,
    worktreeId: wt.worktreeId ?? wt.trackId,
    worktreePath: wt.worktreePath,
    branch: wt.branch,
    baseBranch: wt.baseBranch,
    lockPath: wt.lockPath,
    createdAt: wt.createdAt,
    status: wt.status,
    tier: "orchestrator" as const,
  }));
}
