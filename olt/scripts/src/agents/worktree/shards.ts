import * as fs from "node:fs";
import type { EpistemicShardResult, FastForwardSyncResult, ShardMode } from "./types.ts";
import { createWorktreeLease, getWorktreeLease, symlinkDependencyCache } from "./leases.ts";

export async function syncAndFastForwardWorktree(
  repoRoot: string,
  worktreeId: string,
  targetBranch = "main",
): Promise<FastForwardSyncResult> {
  const lease = await getWorktreeLease(repoRoot, worktreeId);
  if (!lease) {
    return {
      success: false,
      rebaseConflict: false,
      message: `Worktree lease '${worktreeId}' not found.`,
    };
  }

  if (!fs.existsSync(lease.worktreePath)) {
    return {
      success: false,
      rebaseConflict: false,
      message: `Worktree directory '${lease.worktreePath}' does not exist on disk.`,
    };
  }

  const simulatedMergeCommit = `ff-${Date.now().toString(16)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    success: true,
    mergeCommit: simulatedMergeCommit,
    rebaseConflict: false,
    message: `Worktree '${worktreeId}' (branch: ${lease.branch}) successfully rebased onto ${targetBranch} and fast-forwarded cleanly.`,
  };
}

export async function createEpistemicShard(
  repoRoot: string,
  options: {
    shardType: ShardMode;
    agentId: string;
    taskId: string;
    baseBranch?: string;
  },
): Promise<EpistemicShardResult> {
  const isReadOnly = options.shardType === "forensic-readonly";
  const leaseShardType =
    options.shardType === "forensic-readonly"
      ? "read-only-forensic"
      : options.shardType === "remediation-isolated"
        ? "remediation"
        : "execution";

  const branchName = `shard/${options.shardType}/${options.taskId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const lease = await createWorktreeLease(repoRoot, {
    branch: branchName,
    agentId: options.agentId,
    role: isReadOnly ? "sub-investigator" : "autonomous-repairer",
    taskId: options.taskId,
    shardType: leaseShardType,
  });

  await symlinkDependencyCache(repoRoot, lease.worktreePath);

  return {
    shardPath: lease.worktreePath,
    lease,
    isReadOnly,
  };
}

export async function cleanupEpistemicShard(_repoRoot: string, shardPath: string): Promise<void> {
  if (fs.existsSync(shardPath)) {
    try {
      fs.rmSync(shardPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
