export const DEFAULT_LEASE_DURATION_MS = 15 * 60 * 1000;

export const DEFAULT_CACHE_DIRECTORIES = [
  "node_modules",
  ".cache",
  ".turbo",
  "bun.lock",
  "bun.lockb",
] as const;

export type ShardMode = "forensic-readonly" | "remediation-isolated" | "standard-execution";

export interface WorktreeLease {
  readonly worktreeId: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly agentId: string;
  readonly role: string;
  readonly taskId: string;
  readonly shardType: "remediation" | "read-only-forensic" | "execution";
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly lastHeartbeatAt: number;
  readonly status: "active" | "expired" | "released" | "reclaimed";
}

export interface ReclamationReport {
  readonly reclaimedCount: number;
  readonly backedUpCount: number;
  readonly backupPaths: readonly string[];
  readonly reclaimedWorktreeIds: readonly string[];
}

export interface SymlinkCacheResult {
  readonly symlinked: readonly string[];
  readonly savedBytesEstimate: number;
}

export interface FastForwardSyncResult {
  readonly success: boolean;
  readonly mergeCommit?: string;
  readonly rebaseConflict: boolean;
  readonly message: string;
}

export interface EpistemicShardResult {
  readonly shardPath: string;
  readonly lease: WorktreeLease;
  readonly isReadOnly: boolean;
}
