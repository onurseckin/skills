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


