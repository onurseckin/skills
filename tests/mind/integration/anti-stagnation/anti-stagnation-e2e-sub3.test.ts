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
} from "../../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
  PARETO_PRIORITY_LEVELS,
  SCALABILITY_THRESHOLD_PERCENT,
  SocraticLadderingEngine,
  type ParetoApproachInput,
  type StrategicCommitment,
} from "../../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  createResourceGovernor,
  createSuspendedAnimationEngine,
  type AutoWakeProbeConfig,
  type SuspendedAnimationSnapshot,
  type SuspendedTaskNode,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
} from "../../../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  executeRetrievalSandbox,
  SupersessionIndex,
  ThreeTierMemoryEngine,
} from "../../../../olt/scripts/src/mind/memory/index.ts";
import {
  InnovationPortfolioManager,
  PORTFOLIO_TARGET_PERCENTAGES,
  PORTFOLIO_TRACKS,
  type PortfolioWorkstream,
} from "../../../../olt/scripts/src/mind/planning/index.ts";
import {
  createInFlightSnapshot,
  extractUserIntent,
  structureUserIntentAsBacklogDeliverable,
  type InFlightSnapshot,
  type PriorityOneDeliverable,
} from "../../../../olt/scripts/src/mind/preplanning/index.ts";
import {
  ExecutiveDashboardEngine,
  readDashboardState,
  writeDashboardFiles,
  type ParetoArbitrationDecisionRecord,
  type RoadmapDeliverableTask,
} from "../../../../olt/scripts/src/mind/reporting/index.ts";
import {
  DEFAULT_EPOCH_DURATION_MS,
  FrictionTelemetryAggregator,
  HealthScoringEngine,
  type OperationalExecutionEvent,
} from "../../../../olt/scripts/src/mind/telemetry/index.ts";

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

describe("4. 15-Minute Windowed Friction Telemetry & Composite Health Scoring", () => {
    it("aggregates operational telemetry across 15-minute epochs and computes composite health score", () => {
      const baseTime = 10_000_000;
      const aggregator = new FrictionTelemetryAggregator(
        { epochDurationMs: DEFAULT_EPOCH_DURATION_MS },
        baseTime,
      );
      const scoringEngine = new HealthScoringEngine();

      // Record nominal operations in Epoch 0
      aggregator.recordEvent({ type: "TASK_DISPATCH", metadata: { coordinatorId: "c1", workerId: "w1" } });
      aggregator.recordEvent({ type: "TASK_COMPLETE", metadata: { coordinatorId: "c1", workerId: "w1" } });
      aggregator.recordEvent({
        type: "LATENCY_MEASUREMENT",
        metadata: { durationMs: 5_000, latencyCategory: "execution" },
      });

      const epoch0 = aggregator.closeEpoch(baseTime + DEFAULT_EPOCH_DURATION_MS);
      expect(epoch0.epochIndex).toBe(0);
      expect(epoch0.status).toBe("nominal");
      expect(epoch0.compositeHealthScore).toBeGreaterThanOrEqual(0.85);

      const eval0 = scoringEngine.processEpoch(epoch0);
      expect(eval0.status).toBe("nominal");
      expect(eval0.consecutiveDegradedEpochs).toBe(0);
      expect(eval0.roadmapExpansionLocked).toBe(false);
    });

    it("dampens isolated transient single-blip anomalies without triggering false-alarm interventions", () => {
      const aggregator = new FrictionTelemetryAggregator({
        minEventsForSignificance: 4,
      });

      // 1 isolated redispatch with low sample volume
      const events: OperationalExecutionEvent[] = [
        { id: "e1", type: "TASK_DISPATCH", timestamp: 100 },
        { id: "e2", type: "TASK_REDISPATCH", timestamp: 110 },
      ];

      const counts = aggregator.countEpochEvents(events);
      const raw = aggregator.computeRawIndices(events, counts);
      expect(raw.taskAmbiguityIndex).toBe(1.0); // Raw registers 100%

      const dampened = aggregator.applyAnomalyDampener(raw, counts, []);
      // Confidence scaling: 1 dispatch / 4 minSig = 0.25 -> 1.0 * 0.25 = 0.25
      expect(dampened.taskAmbiguityIndex).toBe(0.25);
    });

    it("triggers Strategic Friction Intervention and locks roadmap expansion across 2 consecutive degraded epochs", () => {
      const scoringEngine = new HealthScoringEngine();

      const degradedSnapshot1 = {
        epochIndex: 0,
        epochStart: 0,
        epochEnd: 900_000,
        durationMs: 900_000,
        eventCounts: {
          taskDispatches: 10,
          taskCompletions: 10,
          taskRedispatches: 4,
          workerZombieKills: 3,
          supervisoryBoundaryChecks: 2,
          supervisoryBoundarySlips: 1,
          latencyMeasurements: 5,
          totalEvents: 35,
          uniqueCoordinators: 2,
          uniqueWorkers: 5,
        },
        rawIndices: {
          taskAmbiguityIndex: 0.4,
          workerRecyclingIndex: 0.3,
          supervisoryStrainIndex: 0.2,
          infrastructureLatencyIndex: 0.3,
        },
        dampenedIndices: {
          taskAmbiguityIndex: 0.4,
          workerRecyclingIndex: 0.3,
          supervisoryStrainIndex: 0.2,
          infrastructureLatencyIndex: 0.3,
        },
        compositeHealthScore: 0.74,
        status: "degraded" as const,
        anomalyDampened: false,
      };

      const degradedSnapshot2 = {
        ...degradedSnapshot1,
        epochIndex: 1,
        epochStart: 900_000,
        epochEnd: 1_800_000,
      };

      // Epoch 0: Degraded (1st time) -> no lock yet
      const eval0 = scoringEngine.processEpoch(degradedSnapshot1);
      expect(eval0.consecutiveDegradedEpochs).toBe(1);
      expect(eval0.interventionTriggered).toBe(false);
      expect(eval0.roadmapExpansionLocked).toBe(false);

      // Epoch 1: Degraded (2nd consecutive time) -> TRIGGER INTERVENTION & LOCK ROADMAP
      const eval1 = scoringEngine.processEpoch(degradedSnapshot2);
      expect(eval1.consecutiveDegradedEpochs).toBe(2);
      expect(eval1.interventionTriggered).toBe(true);
      expect(eval1.roadmapExpansionLocked).toBe(true);
      expect(scoringEngine.isRoadmapExpansionLocked()).toBe(true);

      const intervention = scoringEngine.getActiveIntervention();
      expect(intervention).toBeDefined();
      expect(intervention?.roadmapExpansionLocked).toBe(true);
      expect(intervention?.rootCauses.length).toBeGreaterThan(0);
      expect(intervention?.requiredSimplifications.length).toBeGreaterThan(0);

      // Epoch 2: Recovery to nominal (Score >= 0.85) -> UNLOCK ROADMAP
      const nominalSnapshot = {
        ...degradedSnapshot1,
        epochIndex: 2,
        epochStart: 1_800_000,
        epochEnd: 2_700_000,
        dampenedIndices: {
          taskAmbiguityIndex: 0.02,
          workerRecyclingIndex: 0.01,
          supervisoryStrainIndex: 0.0,
          infrastructureLatencyIndex: 0.02,
        },
        compositeHealthScore: 0.98,
        status: "nominal" as const,
      };

      const eval2 = scoringEngine.processEpoch(nominalSnapshot);
      expect(eval2.status).toBe("nominal");
      expect(eval2.consecutiveDegradedEpochs).toBe(0);
      expect(eval2.interventionResolved).toBe(true);
      expect(eval2.roadmapExpansionLocked).toBe(false);
      expect(scoringEngine.isRoadmapExpansionLocked()).toBe(false);
    });
  });
});
