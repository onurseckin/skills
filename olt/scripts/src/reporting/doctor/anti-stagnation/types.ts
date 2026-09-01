
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { findRepoRoot } from "../../../core/index.ts";
import { loadRun } from "../../../engine/store/index.ts";
import {
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
  SCALABILITY_THRESHOLD_PERCENT,
  type SerializedDebateMemory,
  type StrategicCommitment,
  type StrategicResolution,
} from "../../../mind/auditing/socratic/index.ts";
import {
  type LineageValidationResult,
  type SupersessionIndexState,
  type SupersessionNode,
  SupersessionIndex,
} from "../../../mind/memory/index.ts";
import {
  type SuspendedAnimationSnapshot,
  readSnapshotFromDisk,
  resolveSuspendedStatePath,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
} from "../../../mind/lifecycle/index.ts";
import {
  type ExecutiveDashboardState,
  resolveDashboardPaths,
} from "../../../mind/reporting/index.ts";
import type {
  DoctorCheckEngineResult,
  DoctorDiagnosticFinding,
  DoctorSeverity,
} from "../index.ts";


// ============================================================================
// 1. Invariant Definitions & Types
// ============================================================================

export const MIND_CHARTER_INVARIANTS = [
  "SUPERVISOR_ZERO_CODE_EDITS",
  "SUPERVISOR_ZERO_TEST_RUNS",
  "THREE_STRIKE_MECHANICAL_CONTAINMENT",
  "ANTI_MAKEWORK_GENUINE_VALUE",
  "CUMULATIVE_SOCRATIC_PROGRESSION",
  "PRE_DECLARED_PARETO_ARBITRATION",
  "INNOVATION_PORTFOLIO_70_20_10",
  "ERGONOMIC_WALKTHROUGH_AUDITING",
  "THREE_TIER_SEMANTIC_MEMORY",
  "EPISTEMIC_SUPERSESSION_INDEXING",
  "SUSPENDED_ANIMATION_PROTOCOL",
  "INFLIGHT_WORK_INGESTION",
  "DIAGNOSTIC_CLUSTERING",
  "LIVE_EXECUTIVE_DASHBOARD",
  "MANDATORY_3_ROUND_SOCRATIC_LADDERING",
  "DIRECT_1_ON_1_CONVERSATIONAL_AUDITS",
] as const;

export type MindCharterInvariant = (typeof MIND_CHARTER_INVARIANTS)[number];

export const DEFAULT_MAX_DASHBOARD_STALENESS_MS = 300_000; // 5 minutes

export interface AntiStagnationDoctorOptions {
  readonly runRoot?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly commands?: Readonly<Record<string, unknown>> | readonly unknown[] | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
  readonly nowMs?: number | undefined;
  readonly maxDashboardStalenessMs?: number | undefined;
  readonly socraticMemory?:
    | SerializedDebateMemory
    | HistoricalDebateMemory
    | Readonly<Record<string, unknown>>
    | null
    | undefined;
  readonly supersessionIndex?: SupersessionIndex | SupersessionIndexState | null | undefined;
  readonly suspendedSnapshot?: SuspendedAnimationSnapshot | null | undefined;
  readonly autoHeal?: boolean | undefined;
}

export interface InvariantAuditResult {
  readonly invariant: MindCharterInvariant;
  readonly compliant: boolean;
  readonly severity: DoctorSeverity;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export interface AntiStagnationAuditReport {
  readonly healthy: boolean;
  readonly runRoot: string;
  readonly timestamp: string;
  readonly invariantsChecked: number;
  readonly violationsCount: number;
  readonly invariantResults: readonly InvariantAuditResult[];
  readonly findings: readonly DoctorDiagnosticFinding[];
  readonly executiveDashboardStatus: {
    readonly present: boolean;
    readonly stale: boolean;
    readonly latencyMs?: number | undefined;
    readonly balanced: boolean;
    readonly balanceStatus?: string | undefined;
  };
  readonly supervisoryPurity: {
    readonly pure: boolean;
    readonly codeEditViolationsCount: number;
    readonly testRunViolationsCount: number;
  };
  readonly socraticMemoryHealth: {
    readonly intact: boolean;
    readonly unfulfilledCommitmentsCount: number;
    readonly unjustifiedCommitmentsCount: number;
    readonly deadlockedImpassesCount: number;
  };
  readonly supersessionIndexingHealth: {
    readonly acyclic: boolean;
    readonly nodeCount: number;
    readonly cycleCount: number;
  };
  readonly suspendedAnimationHealth: {
    readonly intact: boolean;
    readonly activeSuspension: boolean;
    readonly checksumValid?: boolean | undefined;
    readonly dagAcyclic?: boolean | undefined;
  };
  readonly autoHealedActions?: readonly string[] | undefined;
}

// ============================================================================