import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
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
