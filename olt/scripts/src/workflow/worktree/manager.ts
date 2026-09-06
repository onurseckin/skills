import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { listWorktrees } from "./discovery.ts";
import { branchExists, runGit } from "./git-ops.ts";
import { git } from "./git.ts";
import { acquireTrackLock, releaseTrackLock } from "./lock.ts";
import { createOrchestratorWorktree, destroyOrchestratorWorktree } from "./orchestrator.ts";
import {
  assertSafeWorktreePath,
  IDENTIFIER_REGEX,
  resolveRepo,
  teardownWorktree,
} from "./teardown.ts";
import type { CleanupWorktreeOptions, CreateWorktreeOptions, TrackWorktreeInfo } from "./types.ts";

export * from "./types.ts";
export * from "./orchestrator.ts";
export * from "./lock.ts";
export { listWorktrees } from "./discovery.ts";
export const listTrackWorktrees = listWorktrees;
export {
  resolveRepo,
  teardownWorktree,
  assertSafeWorktreePath,
  IDENTIFIER_REGEX,
} from "./teardown.ts";
export { landTrackToMain } from "./landing.ts";

export function createTrackWorktree(trackId: string): string;
export function createTrackWorktree(options: CreateWorktreeOptions): TrackWorktreeInfo;
export function createTrackWorktree(
  trackIdOrOptions: string | CreateWorktreeOptions,
): string | TrackWorktreeInfo {
  const options: CreateWorktreeOptions =
    typeof trackIdOrOptions === "string" ? { trackId: trackIdOrOptions } : trackIdOrOptions;

  if (options.tier === "orchestrator" || options.orchestrator) {
    const domain = options.orchestrator ?? options.domain ?? options.trackId;
    if (!domain) {
      throw new HarnessError("INVALID_ARGUMENT", "Missing domain for orchestrator worktree.");
    }
    const orchInfo = createOrchestratorWorktree({
      domain,
      baseBranch: options.baseBranch,
      repoRoot: options.repoRoot,
      lockTimeoutMs: options.lockTimeoutMs,
      runner: options.runner,
      now: options.now,
    });
    return typeof trackIdOrOptions === "string" ? orchInfo.worktreePath : orchInfo;
  }

  if (!options.trackId || !IDENTIFIER_REGEX.test(options.trackId)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid trackId: '${options.trackId}'. Must contain only alphanumeric characters, dashes, or underscores.`,
    );
  }

  const repo = resolveRepo(options.repoRoot);
  const worktreesRoot = join(repo, ".olt", "worktrees");
  const worktreePath = join(worktreesRoot, options.trackId);
  assertSafeWorktreePath(worktreePath, worktreesRoot);

  const lockPath = join(worktreesRoot, "locks", `${options.trackId}.lock`);
  acquireTrackLock(lockPath, options.trackId, options.lockTimeoutMs);

  const runner = options.runner ?? runGit;
  const baseBranch = options.baseBranch ?? "main";
  const branch = `track/${options.trackId}`;
  const createdAt = (options.now ?? new Date()).toISOString();

  try {
    mkdirSync(worktreesRoot, { recursive: true });
    if (branchExists(repo, branch, runner)) {
      git(repo, ["worktree", "add", worktreePath, branch], runner);
    } else {
      git(repo, ["worktree", "add", "-b", branch, worktreePath, baseBranch], runner);
    }

    const info: TrackWorktreeInfo = {
      trackId: options.trackId,
      worktreeId: options.trackId,
      worktreePath,
      branch,
      baseBranch,
      lockPath,
      createdAt,
      status: "active",
      tier: "track",
    };

    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(
      join(worktreePath, ".worktree-meta.json"),
      JSON.stringify(info, null, 2),
      "utf-8",
    );
    return typeof trackIdOrOptions === "string" ? worktreePath : info;
  } catch (error) {
    releaseTrackLock(lockPath);
    throw error;
  }
}

export function createWorktree(options: CreateWorktreeOptions): TrackWorktreeInfo {
  if (options.tier === "orchestrator" || options.orchestrator) {
    const domain = options.orchestrator ?? options.domain ?? options.trackId;
    if (!domain) {
      throw new HarnessError("INVALID_ARGUMENT", "Missing domain for orchestrator worktree.");
    }
    return createOrchestratorWorktree({
      domain,
      baseBranch: options.baseBranch,
      repoRoot: options.repoRoot,
      lockTimeoutMs: options.lockTimeoutMs,
      runner: options.runner,
      now: options.now,
    });
  }
  return createTrackWorktree(options);
}

export function destroyTrackWorktree(trackId: string): void;
export function destroyTrackWorktree(options: CleanupWorktreeOptions): {
  cleaned: boolean;
  trackId: string;
};
export function destroyTrackWorktree(
  trackIdOrOptions: string | CleanupWorktreeOptions,
): void | { cleaned: boolean; trackId: string } {
  const options: CleanupWorktreeOptions =
    typeof trackIdOrOptions === "string" ? { trackId: trackIdOrOptions } : trackIdOrOptions;
  const trackId = options.trackId!;
  const repo = resolveRepo(options.repoRoot);
  const worktreesRoot = join(repo, ".olt", "worktrees");
  const worktreePath = join(worktreesRoot, trackId);
  const lockPath = join(worktreesRoot, "locks", `${trackId}.lock`);
  const branch = `track/${trackId}`;
  teardownWorktree(trackId, {
    repo,
    worktreePath,
    branch,
    lockPath,
    deleteBranch: options.deleteBranch ?? true,
    force: options.force ?? false,
    runner: options.runner,
  });
  if (typeof trackIdOrOptions === "string") return;
  return { cleaned: true, trackId };
}

export const cleanupTrackWorktree = destroyTrackWorktree;

export function destroyWorktree(options: CleanupWorktreeOptions): {
  cleaned: boolean;
  trackId: string;
} {
  if (
    options.tier === "orchestrator" ||
    options.orchestrator ||
    options.trackId?.startsWith("orch-")
  ) {
    const domain = options.orchestrator ?? options.domain ?? options.trackId!;
    const res = destroyOrchestratorWorktree({
      domain,
      repoRoot: options.repoRoot,
      force: options.force,
      deleteBranch: options.deleteBranch,
      runner: options.runner,
    });
    return { cleaned: res.cleaned, trackId: res.trackId };
  }
  return destroyTrackWorktree(options);
}

export const cleanupWorktree = destroyWorktree;
