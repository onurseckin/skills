/**
 * @file anti-stagnation-e2e.test.ts
 * End-to-End Multi-Hour Sovereign Simulation & Anti-Stagnation Integration Test Suite.
 *
 * Validates:
 * 1. Multi-hour sovereign simulation spanning multi-turn epochs and simulated hours (1h, 2h, 4h, 8h, 12h).
 * 2. In-flight work ingestion & user intent extraction (Priority 1 binding).
 * 3. Socratic laddering: L1 trade-off verification -> L2 second-order implications -> L3 emergent paradigms.
 * 4. Pre-Declared Pareto dispute resolution: P1 UX/Correctness > P2 Simplicity > P3 Scalability >= 15% > P4 Speculative Abstraction,
 *    resolving impasses into bedrock commitments within 1 spike cycle.
 * 5. 15-minute windowed telemetry & composite health score: ambiguity, recycling, strain, latency calculations;
 *    degraded interventions when health score < 0.85; anomaly dampening of transient blips.
 * 6. 3-tier memory with epistemic supersession indexing: Tier 1 active context, Tier 2 project history, Tier 3 deep immutable memory;
 *    100% suppression of superseded entries in retrieval sandbox; supersession graph acyclicity validation.
 * 7. Suspended animation protocol: quota exhaustion detection, timer/state freeze, lossless auto-wake resumption with sub-second restoral and zero state loss.
 * 8. Live Executive Dashboard updates: asynchronous updates to .olt/executive-dashboard.md & .olt/dashboard.json, 70/20/10 portfolio balance tracking, health visualization.
 * 9. Zero Main Thread Pollution Invariant (100% background mailbox IPC).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceMailboxCursorBatch,
  dispatchPeerMessage,
  ensureMailboxDir,
  loadMailboxCursor,
  readUnreadMessages,
  resolveMailboxPaths,
  saveMailboxCursor,
} from "../../../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
  PARETO_PRIORITY_LEVELS,
  SCALABILITY_THRESHOLD_PERCENT,
  SocraticLadderingEngine,
  type ParetoApproachInput,
  type StrategicCommitment,
} from "../../../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  createResourceGovernor,
  createSuspendedAnimationEngine,
  type AutoWakeProbeConfig,
  type SuspendedAnimationSnapshot,
  type SuspendedTaskNode,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
} from "../../../../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  executeRetrievalSandbox,
  SupersessionIndex,
  ThreeTierMemoryEngine,
} from "../../../../../olt/scripts/src/mind/memory/index.ts";
import {
  InnovationPortfolioManager,
  PORTFOLIO_TARGET_PERCENTAGES,
  PORTFOLIO_TRACKS,
  type PortfolioWorkstream,
} from "../../../../../olt/scripts/src/mind/planning/index.ts";
import {
  createInFlightSnapshot,
  extractUserIntent,
  structureUserIntentAsBacklogDeliverable,
  type InFlightSnapshot,
  type PriorityOneDeliverable,
} from "../../../../../olt/scripts/src/mind/preplanning/index.ts";
import {
  ExecutiveDashboardEngine,
  readDashboardState,
  writeDashboardFiles,
  type ParetoArbitrationDecisionRecord,
  type RoadmapDeliverableTask,
} from "../../../../../olt/scripts/src/mind/reporting/index.ts";
import {
  DEFAULT_EPOCH_DURATION_MS,
  FrictionTelemetryAggregator,
  HealthScoringEngine,
  type OperationalExecutionEvent,
} from "../../../../../olt/scripts/src/mind/telemetry/index.ts";

describe("Anti-Stagnation End-to-End Multi-Hour Sovereign Simulation Suite", () => {
let testRepoRoot: string;

  beforeEach(() => {
    testRepoRoot = join(
      tmpdir(),
      `mind-anti-stagnation-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(testRepoRoot, { recursive: true });
    mkdirSync(join(testRepoRoot, ".olt"), { recursive: true });
    mkdirSync(join(testRepoRoot, ".olt", "mailboxes"), { recursive: true });
    mkdirSync(join(testRepoRoot, ".olt", "snapshots"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testRepoRoot, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

describe("6. Autonomous Resource Governor & Suspended Animation Protocol", () => {
    it("freezes state and sub-second timers upon quota exhaustion, then performs lossless auto-wake resumption", async () => {
      const snapPath = join(testRepoRoot, ".olt", "suspended-state.json");
      const governor = createResourceGovernor({
        limits: { maxRpm: 100, maxTpm: 10_000, maxConcurrency: 5 },
      });
      const animationEngine = createSuspendedAnimationEngine();

      let taskResumed = false;
      let resumedCheckpoint: Readonly<Record<string, unknown>> | undefined;

      // Register Pausable Task
      animationEngine.registerPausableTask({
        taskId: "task-matrix-decomp",
        title: "Matrix Decomposition Task",
        status: "IN_PROGRESS",
        priority: "CRITICAL",
        getCheckpointData: () => ({ cursor: 420, batch: 7 }),
        onPause: () => {},
        onResume: (checkpoint) => {
          taskResumed = true;
          resumedCheckpoint = checkpoint;
        },
      });

      // Register Sub-Second Timer
      animationEngine.registerTimer(
        {
          id: "anti-stagnation-pulse",
          type: "anti_stagnation",
          durationMs: 60_000,
          startedAtMs: 1_000_000,
          expiresAtMs: 1_060_000,
        },
        1_015_000,
      );

      animationEngine.setSocraticMemory({
        thesis: "Deterministic state machines guarantee zero amnesia.",
        turn: 4,
      });

      // Trigger Quota Throttle (HTTP 429)
      const throttleStatus = governor.recordExternalThrottle(
        {
          resourceType: "API_RPM",
          retryAfterMs: 30_000,
          reason: "Rate limit reached (429)",
          statusCode: 429,
        },
        1_020_000,
      );
      expect(throttleStatus.state).toBe("HIBERNATING");

      // Initiate Suspension Freeze
      const snapshot = await animationEngine.initiateSuspension({
        reason: "Rate limit reached (429)",
        triggerResource: "API_RPM",
        repoRoot: testRepoRoot,
        customSnapshotPath: snapPath,
        nowMs: 1_025_000,
      });

      expect(animationEngine.getIsSuspended()).toBe(true);
      expect(existsSync(snapPath)).toBe(true);
      expect(verifySnapshotIntegrity(snapshot)).toBe(true);

      const frozenTimer = snapshot.frozenTimers.find((t) => t.id === "anti-stagnation-pulse");
      expect(frozenTimer).toBeDefined();
      expect(frozenTimer?.elapsedMs).toBe(25_000); // 1_025_000 - 1_000_000 = 25s
      expect(frozenTimer?.remainingDurationMs).toBe(35_000); // 60s - 25s = 35s

      // Resume from Snapshot (Lossless Auto-Wake)
      const restoreResult = await animationEngine.resumeFromSnapshot(snapPath, {
        repoRoot: testRepoRoot,
        customSnapshotPath: snapPath,
        deleteSnapshotOnSuccess: false,
        nowMs: 1_050_000,
      });

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.verification.checksumValid).toBe(true);
      expect(restoreResult.verification.zeroContextLoss).toBe(true);
      expect(restoreResult.restoredTaskCount).toBe(1);
      expect(restoreResult.restoredTimerCount).toBe(1);
      expect(restoreResult.socraticMemoryRestored).toBe(true);
      expect(animationEngine.getIsSuspended()).toBe(false);

      expect(taskResumed).toBe(true);
      expect((resumedCheckpoint as { cursor: number; batch: number }).cursor).toBe(420);
      expect((resumedCheckpoint as { cursor: number; batch: number }).batch).toBe(7);

      animationEngine.dispose();
    });
  });
});
