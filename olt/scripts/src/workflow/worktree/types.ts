import type { GitRunner } from "./git-ops.ts";

export interface TrackWorktreeInfo {
  trackId: string;
  worktreeId?: string | undefined;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  lockPath: string;
  createdAt: string;
  status: "active" | "stale" | "orphaned";
  tier?: "track" | "orchestrator" | undefined;
  domain?: string | undefined;
}

export interface OrchestratorWorktreeInfo {
  domain: string;
  trackId: string;
  worktreeId: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  lockPath: string;
  createdAt: string;
  status: "active" | "stale" | "orphaned";
  tier: "orchestrator";
}

export interface CreateWorktreeOptions {
  trackId?: string | undefined;
  tier?: "track" | "orchestrator" | undefined;
  domain?: string | undefined;
  orchestrator?: string | undefined;
  baseBranch?: string | undefined;
  repoRoot?: string | undefined;
  lockTimeoutMs?: number | undefined;
  runner?: GitRunner | undefined;
  now?: Date | undefined;
}

export interface CreateOrchestratorWorktreeOptions {
  domain: string;
  baseBranch?: string | undefined;
  repoRoot?: string | undefined;
  lockTimeoutMs?: number | undefined;
  runner?: GitRunner | undefined;
  now?: Date | undefined;
}

export interface CleanupWorktreeOptions {
  trackId?: string | undefined;
  domain?: string | undefined;
  orchestrator?: string | undefined;
  tier?: "track" | "orchestrator" | undefined;
  repoRoot?: string | undefined;
  force?: boolean | undefined;
  deleteBranch?: boolean | undefined;
  runner?: GitRunner | undefined;
}

export interface CleanupOrchestratorWorktreeOptions {
  domain: string;
  repoRoot?: string | undefined;
  force?: boolean | undefined;
  deleteBranch?: boolean | undefined;
  runner?: GitRunner | undefined;
}

export interface ListWorktreesOptions {
  repoRoot?: string | undefined;
  runner?: GitRunner | undefined;
  tier?: "all" | "track" | "orchestrator" | undefined;
}
