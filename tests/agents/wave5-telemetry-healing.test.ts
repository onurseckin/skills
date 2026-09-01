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

describe("Wave 5: Multi-Track Telemetry & Universal Self-Healing", () => {
  beforeEach(() => {
    cleanTestRoot();
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    cleanTestRoot();
  });

  describe("Multi-Track Telemetry & Universal Self-Healing", () => {
    it("computes execution health score and tracks Track Alpha heartbeat lineage", () => {
      // Perfect metrics -> 100
      const perfect = computeExecutionHealthScore({
        toolErrors: 0,
        stagnationSeconds: 60,
        memorySupersessionDepth: 1,
        leaseUtilizationRatio: 0.1,
      });
      expect(perfect).toBe(100);

      // Degraded metrics
      const degraded = computeExecutionHealthScore({
        toolErrors: 3,
        stagnationSeconds: 480,
        memorySupersessionDepth: 8,
        leaseUtilizationRatio: 0.95,
      });
      expect(degraded).toBeLessThan(50);

      // Track Alpha heartbeat recording
      let alphaState = createTrackAlphaState("agent-alpha-1");
      expect(alphaState.healthScore).toBe(100);
      expect(alphaState.memorySupersessionDepth).toBe(0);

      alphaState = recordAlphaHeartbeat(
        alphaState,
        { id: "mem-snap-1", summary: "Parsed AST tree for modules" },
        { toolErrors: 0, stagnationSeconds: 60, leaseUtilizationRatio: 0.2 },
      );

      expect(alphaState.memorySupersessionDepth).toBe(1);
      expect(alphaState.memorySnapshots.length).toBe(1);
      expect(alphaState.stagnationRisk).toBe("nominal");
    });

    it("manages Track Beta strategic rounds and convergence scoring", () => {
      let betaState = createTrackBetaState("epoch-gamma-1", 60 * 60 * 1000, 5);
      expect(betaState.round).toBe(1);
      expect(betaState.status).toBe("deliberating");

      // Round 1 deliberation
      betaState = recordBetaRound(betaState, {
        convergenceScore: 0.55,
        newAnchor: "Unified telemetry schema settled",
      });
      expect(betaState.round).toBe(2);
      expect(betaState.strategicAnchors.length).toBe(1);
      expect(betaState.status).toBe("deliberating");

      // Round 2 convergence reach
      betaState = recordBetaRound(betaState, {
        convergenceScore: 0.92,
        newAnchor: "Final validation consensus achieved",
      });
      expect(betaState.status).toBe("converged");
    });

    it("synchronizes Strategic Epoch Mesh across Track Alpha agents and Track Beta oversight", () => {
      const meshState = createEpochMesh("epoch-delta-100");
      expect(meshState.isSynchronized).toBe(true);

      const alpha1 = recordAlphaHeartbeat(createTrackAlphaState("agent-alpha-1"));
      const alpha2 = recordAlphaHeartbeat(createTrackAlphaState("agent-alpha-2"));
      const betaState = createTrackBetaState("epoch-delta-100");

      const syncResult = syncTrackAlphaAndBeta(meshState, [alpha1, alpha2], betaState);
      expect(syncResult.activeAlphaCount).toBe(2);
      expect(syncResult.averageHealthScore).toBe(100);
      expect(syncResult.nextMeshState.activeAlphaAgents).toContain("agent-alpha-1");
      expect(syncResult.nextMeshState.activeAlphaAgents).toContain("agent-alpha-2");

      const advanced = advanceEpoch(syncResult.nextMeshState);
      expect(advanced.currentRound).toBe(2);
    });

    it("diagnoses universal health failures and auto-heals stale locks, orphaned worktrees, and dangling browsers", async () => {
      const fakeWorkspace = path.join(SCRATCH_TEST_DIR, "workspace-health");
      fs.mkdirSync(fakeWorkspace, { recursive: true });

      // Simulate stale mailbox lock
      const mailboxLocksDir = path.join(fakeWorkspace, ".olt", "locks", "mailboxes");
      fs.mkdirSync(mailboxLocksDir, { recursive: true });
      const staleLockPath = path.join(mailboxLocksDir, "agent-stale.lock");
      fs.writeFileSync(staleLockPath, "lock", "utf-8");

      // Backdate mtime by 10 minutes
      const pastTime = new Date(Date.now() - 10 * 60 * 1000);
      fs.utimesSync(staleLockPath, pastTime, pastTime);

      // Simulate dangling browser marker
      const browsersDir = path.join(fakeWorkspace, ".olt", "locks");
      fs.writeFileSync(
        path.join(browsersDir, "browsers.json"),
        JSON.stringify([{ pid: 9999, startedAt: Date.now() - 40 * 60 * 1000 }]),
        "utf-8",
      );

      // Run diagnostics
      const healthReport = await diagnoseUniversalHealth(fakeWorkspace);
      expect(healthReport.healthy).toBe(false);
      expect(healthReport.stats.staleLocks).toBe(1);
      expect(healthReport.stats.danglingBrowsers).toBe(1);

      // Execute auto-healing
      const healingReport = await autoHealUniversalHealth(fakeWorkspace, healthReport);
      expect(healingReport.healed).toBe(true);
      expect(healingReport.actionsTaken.length).toBeGreaterThan(0);

      // Verify stale lock and dangling browser were cleaned up
      expect(fs.existsSync(staleLockPath)).toBe(false);
      expect(fs.existsSync(path.join(browsersDir, "browsers.json"))).toBe(false);

      // Re-diagnose
      const postHeal = await diagnoseUniversalHealth(fakeWorkspace);
      expect(postHeal.healthy).toBe(true);
    });

    it("executes zero-parameter ignition bootstrap successfully", async () => {
      const fakeWorkspace = path.join(SCRATCH_TEST_DIR, "workspace-ignition");

      const ignition = await igniteSwarmEcosystem(fakeWorkspace);
      expect(ignition.ready).toBe(true);
      expect(ignition.registeredAgentsCount).toBe(31);
      expect(ignition.healthReport.healthy).toBe(true);
      expect(ignition.epochMesh.isSynchronized).toBe(true);

      // Verify directories created
      expect(fs.existsSync(path.join(fakeWorkspace, ".olt", "mailboxes"))).toBe(true);
      expect(fs.existsSync(path.join(fakeWorkspace, ".olt", "worktrees"))).toBe(true);
      expect(fs.existsSync(path.join(fakeWorkspace, ".olt", "scratch", "backups"))).toBe(true);
    });
  });
});
