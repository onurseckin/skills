export type {
  EpistemicShardResult,
  FastForwardSyncResult,
  ReclamationReport,
  ShardMode,
  SymlinkCacheResult,
  WorktreeLease,
} from "./types.ts";

export { DEFAULT_CACHE_DIRECTORIES, DEFAULT_LEASE_DURATION_MS } from "./types.ts";

export {
  createWorktreeLease,
  getWorktreeLease,
  isLeaseExpired,
  listWorktreeLeases,
  reclaimOrphanedWorktrees,
  releaseWorktreeLease,
  renewWorktreeHeartbeat,
  symlinkDependencyCache,
} from "./leases.ts";

export {
  cleanupEpistemicShard,
  createEpistemicShard,
  syncAndFastForwardWorktree,
} from "./shards.ts";
