const SCRATCH_TEST_DIR = path.join(process.cwd(), ".olt-test-scratch-wave5");
import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ALL_31_AGENT_ARCHETYPES,
  AntiOverheadWatchdog,
  FLEET_CONTRACT_REGISTRY,
  MANDATORY_VIEWPORTS_4,
  OPTICAL_DIMENSIONS_8,
  SYNTHETIC_STATES_4,
  TIER_0_1_GOVERNANCE_AGENTS,
  TIER_2_ORCHESTRATION_AGENTS,
  TIER_3_EXECUTION_AGENTS,
  TIER_3_QUALITY_AGENTS,
  advanceEpoch,
  autoHealUniversalHealth,
  classifyTaskComplexity,
  computeExecutionHealthScore,
  createEpistemicShard,
  createEpochMesh,
  createTrackAlphaState,
  createTrackBetaState,
  createWorktreeLease,
  defaultAntiOverheadWatchdog,
  diagnoseUniversalHealth,
  generateSwarmDispatchPlan,
  getAgentContract,
  getAllAgentArchetypes,
  getWorktreeLease,
  igniteSwarmEcosystem,
  isHeadfulReviewer,
  isHeadlessDebugger,
  isLeaseExpired,
  isSourceCodeBlind,
  listAgentsByCategory,
  listAgentsByTier,
  listWorktreeLeases,
  normalizeAgentRole,
  reclaimOrphanedWorktrees,
  recordAlphaHeartbeat,
  recordBetaRound,
  releaseWorktreeLease,
  renewWorktreeHeartbeat,
  DEFAULT_LEASE_DURATION_MS,
  cleanupEpistemicShard,
  requireAgentContract,
  symlinkDependencyCache,
  syncAndFastForwardWorktree,
  syncTrackAlphaAndBeta,
  validateAgentSpawn,
  validateAgentToolCall,
} from "../../olt/scripts/src/agents/index.ts";


const TEST_ROOT = path.join(process.cwd(), ".olt-test-scratch-wave5");

function cleanTestRoot(): void {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

describe("Wave 5: High-Density Ephemeral Worktree Governance", () => {
  beforeEach(() => {
    cleanTestRoot();
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    cleanTestRoot();
  });

  describe("High-Density Ephemeral Worktree Governance", () => {
    it("symlinks shared dependency cache from repo root with footprint reduction", async () => {
      const fakeRepoRoot = path.join(SCRATCH_TEST_DIR, "repo");
      const fakeWorktree = path.join(SCRATCH_TEST_DIR, "worktree-1");
      fs.mkdirSync(fakeRepoRoot, { recursive: true });
      fs.mkdirSync(path.join(fakeRepoRoot, "node_modules"), { recursive: true });
      fs.writeFileSync(path.join(fakeRepoRoot, "bun.lock"), "lock-data", "utf-8");

      const result = await symlinkDependencyCache(fakeRepoRoot, fakeWorktree, ["node_modules", "bun.lock"]);
      expect(result.symlinked).toContain("node_modules");
      expect(result.symlinked).toContain("bun.lock");
      expect(result.savedBytesEstimate).toBeGreaterThan(0);

      // Verify symlinks exist in worktree
      expect(fs.existsSync(path.join(fakeWorktree, "node_modules"))).toBe(true);
      expect(fs.existsSync(path.join(fakeWorktree, "bun.lock"))).toBe(true);
    });

    it("manages strict 15-minute lease lifecycles, renewals, and expiration", async () => {
      const fakeRepoRoot = path.join(SCRATCH_TEST_DIR, "repo-lease");
      fs.mkdirSync(fakeRepoRoot, { recursive: true });

      const lease = await createWorktreeLease(fakeRepoRoot, {
        branch: "feature/wave5",
        agentId: "implementer-1",
        role: "primary-implementer",
        taskId: "task-101",
        customDurationMs: DEFAULT_LEASE_DURATION_MS,
      });

      expect(lease.status).toBe("active");
      expect(lease.expiresAt - lease.createdAt).toBe(DEFAULT_LEASE_DURATION_MS);
      expect(isLeaseExpired(lease, lease.createdAt + 1000)).toBe(false);
      expect(isLeaseExpired(lease, lease.createdAt + DEFAULT_LEASE_DURATION_MS + 5000)).toBe(true);

      // Renew heartbeat
      const renewal = await renewWorktreeHeartbeat(fakeRepoRoot, lease.worktreeId, 600);
      expect(renewal.success).toBe(true);
      expect(renewal.newExpiry).toBeGreaterThan(lease.createdAt);

      // Retrieve lease
      const retrieved = await getWorktreeLease(fakeRepoRoot, lease.worktreeId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.worktreeId).toBe(lease.worktreeId);

      // Release lease
      const released = await releaseWorktreeLease(fakeRepoRoot, lease.worktreeId);
      expect(released).toBe(true);

      const afterRelease = await getWorktreeLease(fakeRepoRoot, lease.worktreeId);
      expect(afterRelease?.status).toBe("released");
    });

    it("automatically reclaims orphaned worktrees and creates scratch backups", async () => {
      const fakeRepoRoot = path.join(SCRATCH_TEST_DIR, "repo-reclaim");
      fs.mkdirSync(fakeRepoRoot, { recursive: true });

      // Create an expired lease
      const lease = await createWorktreeLease(fakeRepoRoot, {
        branch: "bugfix/stale",
        agentId: "implementer-stale",
        role: "primary-implementer",
        taskId: "task-stale",
        customDurationMs: 1000, // 1 second duration
      });

      // Write some uncommitted scratch code in the worktree
      fs.writeFileSync(path.join(lease.worktreePath, "scratch.ts"), "const x = 42;", "utf-8");

      // Reclaim with a timestamp beyond expiration
      const reclaimReport = await reclaimOrphanedWorktrees(fakeRepoRoot, {
        now: lease.createdAt + 5000,
      });

      expect(reclaimReport.reclaimedCount).toBe(1);
      expect(reclaimReport.backedUpCount).toBe(1);
      expect(reclaimReport.reclaimedWorktreeIds).toContain(lease.worktreeId);

      // Worktree directory should be deleted from worktrees
      expect(fs.existsSync(lease.worktreePath)).toBe(false);

      // Backup should exist in scratch backups
      expect(reclaimReport.backupPaths.length).toBe(1);
      expect(fs.existsSync(reclaimReport.backupPaths[0])).toBe(true);
      expect(fs.existsSync(path.join(reclaimReport.backupPaths[0], "scratch.ts"))).toBe(true);
    });

    it("performs automated non-destructive rebase sync before fast-forward merges", async () => {
      const fakeRepoRoot = path.join(SCRATCH_TEST_DIR, "repo-ff");
      fs.mkdirSync(fakeRepoRoot, { recursive: true });

      const lease = await createWorktreeLease(fakeRepoRoot, {
        branch: "feature/clean-sync",
        agentId: "implementer-ff",
        role: "primary-implementer",
        taskId: "task-ff-1",
      });

      const syncResult = await syncAndFastForwardWorktree(fakeRepoRoot, lease.worktreeId, "main");
      expect(syncResult.success).toBe(true);
      expect(syncResult.rebaseConflict).toBe(false);
      expect(syncResult.mergeCommit).toBeDefined();
      expect(syncResult.message).toContain("successfully rebased");
    });

    it("creates and cleans up epistemic workspace shards (read-only forensic & remediation)", async () => {
      const fakeRepoRoot = path.join(SCRATCH_TEST_DIR, "repo-shards");
      fs.mkdirSync(fakeRepoRoot, { recursive: true });

      // Forensic Read-Only Shard
      const forensic = await createEpistemicShard(fakeRepoRoot, {
        shardType: "forensic-readonly",
        agentId: "investigator-1",
        taskId: "task-defect-99",
      });
      expect(forensic.isReadOnly).toBe(true);
      expect(forensic.lease.shardType).toBe("read-only-forensic");
      expect(fs.existsSync(forensic.shardPath)).toBe(true);

      // Remediation Shard
      const remediation = await createEpistemicShard(fakeRepoRoot, {
        shardType: "remediation-isolated",
        agentId: "repairer-1",
        taskId: "task-defect-99",
      });
      expect(remediation.isReadOnly).toBe(false);
      expect(remediation.lease.shardType).toBe("remediation");

      // Clean up shards
      await cleanupEpistemicShard(fakeRepoRoot, forensic.shardPath);
      expect(fs.existsSync(forensic.shardPath)).toBe(false);
    });
  });

  // =========================================================================
  // 5. Multi-Track Telemetry & Universal Self-Healing Engine
  // =========================================================================
});
