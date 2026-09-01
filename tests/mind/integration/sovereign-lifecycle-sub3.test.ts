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
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  PARETO_PRIORITY_LEVELS,
  SocraticLadderingEngine,
} from "../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  DiagnosticClusteringEngine,
  runEmpiricalBaselineProbes,
  type BaselineProbeResult,
  type DeficitTopologyMatrix,
  type RawDiagnosticFinding,
} from "../../../olt/scripts/src/mind/defects/diagnostic-clustering.ts";
import {
  MindCadenceEngine,
  createCadenceTrigger,
  createInitialCadenceState,
  enforceInfiniteMindCadence,
  type CadenceState,
} from "../../../olt/scripts/src/mind/lifecycle/cadence/index.ts";
import {
  AutonomousMindInitializer,
  CANONICAL_BEDROCK_INVARIANTS_LIST,
  DEFAULT_STANDARD_CHARTER_YAML,
  executeAutonomousMindInit,
  resolveOrGenerateCharter,
  type MindInitFlowResult,
} from "../../../olt/scripts/src/mind/lifecycle/mind-init-flow.ts";
import {
  ThreeTierMemoryEngine,
} from "../../../olt/scripts/src/mind/memory/index.ts";
import {
  InnovationPortfolioManager,
  PORTFOLIO_TARGET_PERCENTAGES,
  PORTFOLIO_TRACKS,
  type PortfolioWorkstream,
} from "../../../olt/scripts/src/mind/planning/innovation-portfolio.ts";
import {
  createInFlightSnapshot,
  type InFlightSnapshot,
} from "../../../olt/scripts/src/mind/preplanning/inflight-ingestion.ts";
import {
  extractUserIntent,
  structureUserIntentAsBacklogDeliverable,
  type PriorityOneDeliverable,
  type UserIntentRecord,
} from "../../../olt/scripts/src/mind/preplanning/intent-extraction.ts";
import {
  ExecutiveDashboardEngine,
  readDashboardState,
  type RoadmapDeliverableTask,
} from "../../../olt/scripts/src/mind/reporting/index.ts";

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
