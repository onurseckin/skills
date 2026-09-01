/**
 * @file sovereign-lifecycle.test.ts
 * Sovereign Lifecycle & Autonomous Single-Touch Bootstrap Integration Test Suite.
 *
 * Validates:
 * 1. Stage 1: Non-destructive in-flight snapshot & intent extraction (Priority 1 binding).
 * 2. Stage 2: Active empirical baseline probing & diagnostic clustering into Deficit Topology Matrix
 *    (Class 1 Blockers, Class 2 Regressions, Class 3 Quality Deficits).
 * 3. Stage 3: Strategic goal configuration, 70/20/10 portfolio balancing, bedrock invariants lockdown,
 *    and companion auditor mobilization (Mind Auditor, Skill Auditor, Orchestrator).
 * 4. Perpetual cadence execution: pulse counter increment, cadence state transitions, memory compaction,
 *    supervisor-auditor sparring, and milestone progression.
 * 5. Autonomous bootstrap without requiring human prompts.
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
} from "../../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  PARETO_PRIORITY_LEVELS,
  SocraticLadderingEngine,
} from "../../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  DiagnosticClusteringEngine,
  runEmpiricalBaselineProbes,
  type BaselineProbeResult,
  type DeficitTopologyMatrix,
  type RawDiagnosticFinding,
} from "../../../../olt/scripts/src/mind/defects/diagnostic-clustering.ts";
import {
  MindCadenceEngine,
  createCadenceTrigger,
  createInitialCadenceState,
  enforceInfiniteMindCadence,
  type CadenceState,
} from "../../../../olt/scripts/src/mind/lifecycle/cadence/index.ts";
import {
  AutonomousMindInitializer,
  CANONICAL_BEDROCK_INVARIANTS_LIST,
  DEFAULT_STANDARD_CHARTER_YAML,
  executeAutonomousMindInit,
  resolveOrGenerateCharter,
  type MindInitFlowResult,
} from "../../../../olt/scripts/src/mind/lifecycle/mind-init-flow.ts";
import { ThreeTierMemoryEngine } from "../../../../olt/scripts/src/mind/memory/index.ts";
import {
  InnovationPortfolioManager,
  PORTFOLIO_TARGET_PERCENTAGES,
  PORTFOLIO_TRACKS,
  type PortfolioWorkstream,
} from "../../../../olt/scripts/src/mind/planning/innovation-portfolio.ts";
import {
  createInFlightSnapshot,
  type InFlightSnapshot,
} from "../../../../olt/scripts/src/mind/preplanning/inflight-ingestion.ts";
import {
  extractUserIntent,
  structureUserIntentAsBacklogDeliverable,
  type PriorityOneDeliverable,
  type UserIntentRecord,
} from "../../../../olt/scripts/src/mind/preplanning/intent-extraction.ts";
import {
  ExecutiveDashboardEngine,
  readDashboardState,
  type RoadmapDeliverableTask,
} from "../../../../olt/scripts/src/mind/reporting/index.ts";

describe("Sovereign Lifecycle & Autonomous Single-Touch Bootstrap Suite", () => {
  let testRepoRoot: string;

  beforeEach(() => {
    testRepoRoot = join(
      tmpdir(),
      `mind-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(testRepoRoot, { recursive: true });
    mkdirSync(join(testRepoRoot, ".olt"), { recursive: true });
    mkdirSync(join(testRepoRoot, ".olt", "mailboxes"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testRepoRoot, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  describe("4. Perpetual Cadence Execution & State Machine Transitions", () => {
    it("advances pulse counters, executes cadence transitions, compacts memory, and logs supervisor-auditor sparring", async () => {
      // 1. Initialize Cadence Engine
      const cadenceEngine = new MindCadenceEngine({
        generation: 1,
        baseIntervalMs: 1000,
        applyJitter: false,
      });

      const initialState: CadenceState = cadenceEngine.getState();
      expect(initialState.pulseCounter).toBe(0);
      expect(initialState.currentPhase).toBe("IDLE");
      expect(initialState.closing_permitted).toBe(false);

      // Invariant Check
      const enforcement = enforceInfiniteMindCadence(initialState);
      expect(enforcement.closingForbidden).toBe(true);

      // 2. Pulse 1: Step with productive work
      const step1Result = await cadenceEngine.step({
        trigger: createCadenceTrigger("MANUAL_DISPATCH"),
        pendingTasks: 3,
        pulseOutcome: "VALUE_PRODUCED",
        pulseDurationMs: 1200,
      });
      expect(step1Result.newState.pulseCounter).toBe(1);
      expect(step1Result.decision.shouldRolloverImmediately).toBe(true);

      // 3. Supervisor-Auditor Sparring in Cadence
      const debateMemory = new HistoricalDebateMemory();
      const socraticEngine = new SocraticLadderingEngine(debateMemory);

      socraticEngine.evaluateCycle("pulse-1-cycle", "Wave 5 Horizon Objectives");
      socraticEngine.submitResponse(
        "pulse-1-cycle",
        "Prioritized P1 deliverable and zero-error gates",
        {
          isSatisfactory: true,
        },
      );
      expect(socraticEngine.getState().currentLevel).toBe(
        DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS,
      );

      // 4. Memory Compaction during Cadence
      const memoryEngine = new ThreeTierMemoryEngine();

      // Register Tier 1 permanent axiom
      memoryEngine.addBedrockInvariant({
        id: "inv-sovereign-cadence",
        title: "Perpetual Cadence Invariant",
        category: "AXIOM",
        statement: "Cadence loops run perpetually without requiring human turn-0 prompts.",
        rationale: "Absolute autonomy guarantee.",
      });

      // Register resolved working entries
      memoryEngine.addWorkingEntry({
        id: "epic-pulse-1",
        title: "Initial Diagnostic Baseline",
        category: "ACTIVE_EPIC",
        description: "Baseline completed",
        status: "COMPLETED",
        resolutionSummary: "0 compiler errors, all baseline probes green.",
      });

      memoryEngine.addWorkingEntry({
        id: "epic-pulse-2",
        title: "In-Flight Work Polishing",
        category: "ACTIVE_EPIC",
        description: "In-flight task completed",
        status: "RESOLVED",
        resolutionSummary: "User intent verified with file-scoped tests.",
      });

      expect(memoryEngine.getWorkingMemoryCount()).toBe(2);

      // Prune & Compact to Tier 3
      const pruneResult = memoryEngine.pruneWorkingMemory({ autoArchiveCompleted: true });
      expect(pruneResult.prunedIds).toEqual(["epic-pulse-1", "epic-pulse-2"]);
      expect(memoryEngine.getWorkingMemoryCount()).toBe(0);
      expect(memoryEngine.getArchivedEpicCount()).toBe(2);

      // Tier 1 Invariant has ZERO decay
      expect(memoryEngine.getBedrockInvariantCount()).toBe(1);
      expect(memoryEngine.hasBedrockInvariant("inv-sovereign-cadence")).toBe(true);

      // 5. Cadence Pulse 2: Quiescent Step when work completes
      const step2Result = await cadenceEngine.step({
        trigger: createCadenceTrigger("POLLING"),
        pendingTasks: 0,
        pendingFeedback: 0,
        pulseOutcome: "ZERO_DELTA_STAGNANT",
      });
      expect(step2Result.newState.pulseCounter).toBe(2);
      expect(step2Result.decision.shouldRolloverImmediately).toBe(false);
      expect(step2Result.decision.targetDelayMs).toBeGreaterThan(0);

      const telemetry = cadenceEngine.getTelemetry();
      expect(telemetry.totalPulses).toBe(2);
      expect(telemetry.isAntiIdleActive).toBe(true);
    });
  });

  describe("5. Zero-Parameter Autonomous Bootstrap Execution", () => {
    it("executes single-touch initialization from scratch without requiring human prompts", async () => {
      const initResult: MindInitFlowResult = await executeAutonomousMindInit({
        repo: testRepoRoot,
        simulateProbes: true,
        actor: "owner",
        mindId: "mind-sovereign-01",
      });

      // Verification of Complete Mobilization
      expect(initResult.mind_id).toBe("mind-sovereign-01");
      expect(initResult.generation).toBe(1);
      expect(initResult.charter_sha256).toBeDefined();
      expect(initResult.governance.ready).toBe(true);

      // Companions Deployed
      expect(initResult.companions.deployed).toBe(true);
      expect(initResult.companions.mindAuditorId).toBe("mind-sovereign-01-mind-auditor");
      expect(initResult.companions.skillAuditorId).toBe("mind-sovereign-01-skill-auditor");

      // Hierarchical Grants Mobilized
      const roles = initResult.mobilized_hierarchy.map((g) => g.role);
      expect(roles).toContain("mind");
      expect(roles).toContain("mind-auditor");
      expect(roles).toContain("skill-auditor");
      expect(roles).toContain("orchestrator");

      // Deliverable & Deficit Matrix
      expect(initResult.p1_deliverable.priority).toBe("P1");
      expect(initResult.deficit_topology.summary.healthStatus).toBeDefined();

      // Dashboard Files Created
      expect(existsSync(initResult.dashboard.md_path)).toBe(true);
      expect(existsSync(initResult.dashboard.json_path)).toBe(true);

      const dashboardState = await readDashboardState(testRepoRoot);
      expect(dashboardState).not.toBeNull();
      expect(dashboardState?.trajectory.activeMode).toContain("SOVEREIGN");
      expect(dashboardState?.portfolio.balanceStatus).toBe("BALANCED");

      // Cadence Initialized
      expect(initResult.cadence_initialized).toBe(true);
      expect(initResult.markdown).toContain("SOVEREIGN AUTONOMOUS MIND INITIALIZED");
    });

    it("operates modularly via AutonomousMindInitializer class", async () => {
      const initializer = new AutonomousMindInitializer({
        repo: testRepoRoot,
        simulateProbes: true,
      });

      const inFlight = await initializer.ingestInFlight(testRepoRoot);
      expect(inFlight.snapshot).toBeDefined();
      expect(inFlight.intent).toBeDefined();
      expect(inFlight.deliverable.priority).toBe("P1");

      const probeResult = await initializer.probeBaseline(testRepoRoot, { simulate: true });
      expect(probeResult.topologyMatrix).toBeDefined();

      const fullResult = await initializer.initialize();
      expect(fullResult.mind_id).toBe("mind-gen-1");
      expect(fullResult.cadence_initialized).toBe(true);
      expect(fullResult.governance.ready).toBe(true);
    });
  });
});
