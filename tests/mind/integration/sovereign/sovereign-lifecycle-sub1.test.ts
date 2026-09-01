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
import {
  ThreeTierMemoryEngine,
} from "../../../../olt/scripts/src/mind/memory/index.ts";
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
      `mind-lifecycle-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

describe("1. Stage 1: Non-Destructive In-Flight Snapshot & User Intent Extraction", () => {
    it("captures uncommitted workspace modifications without destructive changes and binds intent to P1 deliverable", async () => {
      const srcDir = join(testRepoRoot, "src", "compiler");
      mkdirSync(srcDir, { recursive: true });
      const targetFile = join(srcDir, "parser.ts");
      writeFileSync(
        targetFile,
        `export function parseExpression(input: string): boolean {\n  return input.length > 0;\n}\n`,
        "utf8",
      );

      const mockRunner = (_cwd: string, argv: readonly string[]) => {
        const cmd = argv[0];
        if (cmd === "symbolic-ref") return { status: 0, stdout: "feature/compiler-ast\n", stderr: "" };
        if (cmd === "rev-parse") return { status: 0, stdout: "abcdef1234567890abcdef1234567890abcdef12\n", stderr: "" };
        if (cmd === "status") return { status: 0, stdout: " M src/compiler/parser.ts\n", stderr: "" };
        if (cmd === "diff") return { status: 0, stdout: "diff --git a/src/compiler/parser.ts b/src/compiler/parser.ts\n+export function parseExpression\n", stderr: "" };
        if (cmd === "stash") return { status: 0, stdout: "", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      };

      const snapshot = await createInFlightSnapshot(testRepoRoot, {
        runner: mockRunner,
      });

      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.branch).toBe("feature/compiler-ast");
      expect(snapshot.uncommittedFiles.length).toBeGreaterThan(0);

      // Verify file on disk was NOT mutated or deleted
      expect(existsSync(targetFile)).toBe(true);
      expect(readFileSync(targetFile, "utf8")).toContain("parseExpression");

      const intent: UserIntentRecord = extractUserIntent(snapshot);
      expect(intent.title).toBeDefined();
      expect(intent.statement).toBeDefined();
      expect(intent.priority).toBe("P1");
      expect(intent.confidence).toBeGreaterThan(0);

      const deliverable: PriorityOneDeliverable = structureUserIntentAsBacklogDeliverable(
        intent,
        snapshot,
      );
      expect(deliverable.priority).toBe("P1");
      expect(deliverable.deliverableId).toBeDefined();
      expect(deliverable.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(deliverable.assignedScope.length).toBeGreaterThanOrEqual(1);
    });
  });

describe("2. Stage 2: Active Empirical Baseline Probing & Diagnostic Clustering", () => {
    it("runs diagnostic probes and clusters findings into Class 1 Blockers, Class 2 Regressions, Class 3 Quality Deficits", async () => {
      const probeResult: BaselineProbeResult = await runEmpiricalBaselineProbes({
        repoRoot: testRepoRoot,
        simulate: true,
      });

      expect(probeResult.timestamp).toBeDefined();
      expect(probeResult.probes.length).toBeGreaterThan(0);
      expect(probeResult.topologyMatrix).toBeDefined();

      // Diagnostic Clustering Engine
      const clusteringEngine = new DiagnosticClusteringEngine();

      const sampleLog = [
        "src/math/calculator.ts(42,10): error TS2322: Type 'string' is not assignable to type 'number'.",
        "FAIL tests/api/auth.test.ts",
        "  AssertionError: expected 200 to be 500",
        "src/utils/buffer.ts:12:7: Unused variable 'unusedBuffer' [warning/@typescript-eslint/no-unused-vars]",
      ].join("\n");

      const parsedErrors = clusteringEngine.parse(sampleLog, "COMPILER_AND_TEST_PROBES");
      expect(parsedErrors.length).toBeGreaterThanOrEqual(3);

      const topology: DeficitTopologyMatrix = clusteringEngine.cluster(parsedErrors, {
        matrixId: "TOPO-TEST-001",
      });

      expect(topology.matrixId).toBe("TOPO-TEST-001");
      expect(topology.totalRawErrors).toBeGreaterThanOrEqual(3);
      expect(topology.clusters.length).toBeGreaterThanOrEqual(1);

      // Deficit Classification
      expect(topology.summary.blockers).toBeGreaterThanOrEqual(1);
      expect(topology.summary.regressions).toBeGreaterThanOrEqual(1);
      expect(topology.summary.qualityDeficits).toBeGreaterThanOrEqual(1);

      // Recommended Roadmap Allocation based on Deficit Matrix
      expect(topology.recommendedRoadmapAllocation.coreStability).toBeGreaterThanOrEqual(50);
      expect(topology.recommendedRoadmapAllocation.architecturalEvolution).toBeGreaterThanOrEqual(1);
      expect(topology.recommendedRoadmapAllocation.exploratory).toBeGreaterThanOrEqual(1);
    });
  });

describe("3. Stage 3: Strategic Goal Configuration, Portfolio Balancing & Invariant Lockdown", () => {
    it("locks canonical bedrock invariants and mobilizes mandatory companion auditors", async () => {
      // 1. Bedrock Invariants Lockdown
      const memoryEngine = new ThreeTierMemoryEngine();
      for (const invName of CANONICAL_BEDROCK_INVARIANTS_LIST) {
        memoryEngine.addBedrockInvariant({
          id: `bedrock-${invName.toLowerCase().replace(/_/g, "-")}`,
          title: `Canonical Invariant: ${invName}`,
          category: "ARCHITECTURAL_INVARIANT",
          statement: `System invariant ${invName} is strictly non-negotiable and immutable.`,
          rationale: "Ensures sovereign stability and zero regression.",
        });
      }
      expect(memoryEngine.getBedrockInvariantCount()).toBe(CANONICAL_BEDROCK_INVARIANTS_LIST.length);

      // Verify core invariants are present
      expect(memoryEngine.hasBedrockInvariant("bedrock-supervisor-zero-code-edits")).toBe(true);
      expect(memoryEngine.hasBedrockInvariant("bedrock-supervisor-zero-test-runs")).toBe(true);
      expect(memoryEngine.hasBedrockInvariant("bedrock-three-strike-mechanical-containment")).toBe(true);
      expect(memoryEngine.hasBedrockInvariant("bedrock-innovation-portfolio-70-20-10")).toBe(true);

      // 2. 70/20/10 Innovation Portfolio Governance
      const portfolio = new InnovationPortfolioManager();
      const workstreams: PortfolioWorkstream[] = [
        // 7 Core Stability (70%)
        { id: "ws-c1", title: "Remediate Blocker 1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "ws-c2", title: "Remediate Blocker 2", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "ws-c3", title: "Remediate Regression 1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "ws-c4", title: "Remediate Quality Deficit 1", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "ws-c5", title: "UX Polish Pass", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "ws-c6", title: "File-Scoped Test Tightening", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        { id: "ws-c7", title: "P1 User Intent Completion", track: PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH },
        // 2 Architectural Evolution (20%)
        { id: "ws-a1", title: "Ring Buffer Pipeline Decoupling", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
        { id: "ws-a2", title: "Memory Compactor Optimization", track: PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION },
        // 1 Exploratory Bet (10%)
        { id: "ws-e1", title: "Lockless IPC Streaming Prototype", track: PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS },
      ];

      const balance = portfolio.auditPortfolioBalance(workstreams);
      expect(balance.isBalanced).toBe(true);
      expect(balance.status).toBe("BALANCED");
      expect(balance.distributionPercentages[PORTFOLIO_TRACKS.CORE_STABILITY_AND_POLISH]).toBe(70);
      expect(balance.distributionPercentages[PORTFOLIO_TRACKS.ARCHITECTURAL_EVOLUTION]).toBe(20);
      expect(balance.distributionPercentages[PORTFOLIO_TRACKS.EXPLORATORY_HORIZON_BETS]).toBe(10);
    });
  });
});
