import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot } from "../../../core/index.ts";
import { loadRun } from "../../../engine/store/index.ts";
import {
  HistoricalDebateMemory,
  type StrategicCommitment,
} from "../../../mind/auditing/socratic/index.ts";
import { SupersessionIndex } from "../../../mind/memory/index.ts";
import {
  verifySnapshotIntegrity,
  validateTaskDagAcyclicity,
} from "../../../mind/lifecycle/index.ts";
import {
  resolveDashboardPaths,
  type ExecutiveDashboardState,
} from "../../../mind/reporting/index.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding, DoctorSeverity } from "../index.ts";
import {
  MIND_CHARTER_INVARIANTS,
  DEFAULT_MAX_DASHBOARD_STALENESS_MS,
  type AntiStagnationDoctorOptions,
  type InvariantAuditResult,
  type AntiStagnationAuditReport,
} from "./types.ts";
import { buildFinding, resolveAgentRoleMap, type InvariantContext } from "./helpers.ts";
import {
  auditSupervisorZeroCodeEdits,
  auditSupervisorZeroTestRuns,
  auditThreeStrikeMechanicalContainment,
  auditAntiMakeworkGenuineValue,
} from "./rules-supervisor.ts";
import {
  auditCumulativeSocraticProgression,
  auditPreDeclaredParetoArbitration,
  auditInnovationPortfolio702010,
  auditErgonomicWalkthrough,
} from "./rules-socratic.ts";
import {
  auditThreeTierSemanticMemory,
  auditEpistemicSupersessionIndexing,
  auditSuspendedAnimationProtocol,
  auditInflightWorkIngestion,
  auditDiagnosticClustering,
} from "./rules-memory.ts";
import {
  auditLiveExecutiveDashboard,
  auditMandatory3RoundSocraticLaddering,
  auditDirect1on1ConversationalAudits,
} from "./rules-executive.ts";

// 4. Main Engine & Audit Implementation
// ============================================================================

export function checkAntiStagnationDoctor(
  options: AntiStagnationDoctorOptions = {},
): DoctorCheckEngineResult {
  const nowMs = options.nowMs ?? Date.now();
  const maxDashboardStalenessMs =
    options.maxDashboardStalenessMs ?? DEFAULT_MAX_DASHBOARD_STALENESS_MS;

  const ctx: InvariantContext = {
    state: options.state,
    events: options.events,
    commands: options.commands,
    grants: options.grants,
    repoRoot: options.repoRoot,
    runRoot: options.runRoot,
    nowMs,
    maxDashboardStalenessMs,
    socraticMemory: options.socraticMemory,
    supersessionIndex: options.supersessionIndex,
    suspendedSnapshot: options.suspendedSnapshot,
    autoHeal: options.autoHeal ?? false,
  };

  const isMindCapsule =
    Boolean(ctx.state?.mind) ||
    Boolean(ctx.state?.pulse) ||
    Boolean(options.socraticMemory) ||
    Boolean(options.supersessionIndex) ||
    Boolean(options.suspendedSnapshot);

  // If this is not a Mind capsule and no Mind state is present, pass cleanly
  if (!isMindCapsule && !options.state && !options.events && !options.commands) {
    return {
      engine: "checkAntiStagnationDoctor",
      passed: true,
      findings: [],
    };
  }

  const roleMap = resolveAgentRoleMap(ctx);

  const allInvariantResults: InvariantAuditResult[] = [
    ...auditSupervisorZeroCodeEdits(ctx, roleMap),
    ...auditSupervisorZeroTestRuns(ctx, roleMap),
    ...auditThreeStrikeMechanicalContainment(ctx),
    ...auditAntiMakeworkGenuineValue(ctx),
    ...auditCumulativeSocraticProgression(ctx),
    ...auditPreDeclaredParetoArbitration(ctx),
    ...auditInnovationPortfolio702010(ctx),
    ...auditErgonomicWalkthrough(ctx),
    ...auditThreeTierSemanticMemory(ctx),
    ...auditEpistemicSupersessionIndexing(ctx),
    ...auditSuspendedAnimationProtocol(ctx),
    ...auditInflightWorkIngestion(ctx),
    ...auditDiagnosticClustering(ctx),
    ...auditLiveExecutiveDashboard(ctx),
    ...auditMandatory3RoundSocraticLaddering(ctx),
    ...auditDirect1on1ConversationalAudits(ctx, roleMap),
  ];

  const findings: DoctorDiagnosticFinding[] = allInvariantResults
    .filter((res) => !res.compliant)
    .map((res) => buildFinding(res.invariant, res.severity, res.message, res.details));

  const hasErrors = findings.some((f) => f.severity === "ERROR");

  return {
    engine: "checkAntiStagnationDoctor",
    passed: !hasErrors,
    findings,
  };
}

export function auditAntiStagnationHealth(
  runRoot: string,
  options: AntiStagnationDoctorOptions = {},
): AntiStagnationAuditReport {
  let repository = options.repoRoot;
  if (!repository) {
    try {
      repository = findRepoRoot(runRoot);
    } catch {
      repository = resolve(runRoot, "..", "..");
    }
  }

  let state = options.state;
  let events = options.events;
  if (!state && existsSync(runRoot)) {
    try {
      const loaded = loadRun(runRoot);
      state = loaded.state as Record<string, unknown>;
      events = loaded.events;
    } catch {}
  }

  const nowMs = options.nowMs ?? Date.now();
  const maxDashboardStalenessMs =
    options.maxDashboardStalenessMs ?? DEFAULT_MAX_DASHBOARD_STALENESS_MS;

  const ctx: InvariantContext = {
    state,
    events,
    commands: options.commands ?? (state?.commands as Record<string, unknown> | undefined),
    grants: options.grants ?? (state?.grants as readonly unknown[] | undefined),
    repoRoot: repository,
    runRoot,
    nowMs,
    maxDashboardStalenessMs,
    socraticMemory: options.socraticMemory,
    supersessionIndex: options.supersessionIndex,
    suspendedSnapshot: options.suspendedSnapshot,
    autoHeal: options.autoHeal ?? false,
  };

  const roleMap = resolveAgentRoleMap(ctx);

  const results: InvariantAuditResult[] = [
    ...auditSupervisorZeroCodeEdits(ctx, roleMap),
    ...auditSupervisorZeroTestRuns(ctx, roleMap),
    ...auditThreeStrikeMechanicalContainment(ctx),
    ...auditAntiMakeworkGenuineValue(ctx),
    ...auditCumulativeSocraticProgression(ctx),
    ...auditPreDeclaredParetoArbitration(ctx),
    ...auditInnovationPortfolio702010(ctx),
    ...auditErgonomicWalkthrough(ctx),
    ...auditThreeTierSemanticMemory(ctx),
    ...auditEpistemicSupersessionIndexing(ctx),
    ...auditSuspendedAnimationProtocol(ctx),
    ...auditInflightWorkIngestion(ctx),
    ...auditDiagnosticClustering(ctx),
    ...auditLiveExecutiveDashboard(ctx),
    ...auditMandatory3RoundSocraticLaddering(ctx),
    ...auditDirect1on1ConversationalAudits(ctx, roleMap),
  ];

  const findings: DoctorDiagnosticFinding[] = results
    .filter((res) => !res.compliant)
    .map((res) => buildFinding(res.invariant, res.severity, res.message, res.details));

  const hasErrors = findings.some((f) => f.severity === "ERROR");

  // Compile Executive Dashboard Sub-Report
  let dashboardPresent = false;
  let dashboardStale = false;
  let dashboardLatencyMs: number | undefined;
  let dashboardBalanced = true;
  let dashboardBalanceStatus: string | undefined;

  if (repository) {
    const dashPaths = resolveDashboardPaths(repository);
    if (existsSync(dashPaths.jsonPath)) {
      dashboardPresent = true;
      try {
        const parsed = JSON.parse(
          readFileSync(dashPaths.jsonPath, "utf-8"),
        ) as ExecutiveDashboardState;
        dashboardBalanceStatus = parsed.portfolio?.balanceStatus;
        dashboardBalanced = parsed.portfolio?.isBalanced ?? true;
        const updated = parsed.trajectory?.lastUpdated ?? parsed.generatedAt;
        const parsedMs = Date.parse(updated);
        if (!Number.isNaN(parsedMs)) {
          dashboardLatencyMs = Math.max(0, nowMs - parsedMs);
          dashboardStale = dashboardLatencyMs > maxDashboardStalenessMs;
        }
      } catch {}
    }
  }

  // Supervisory Purity Sub-Report
  const codeEditViolations = results.filter(
    (r) => r.invariant === "SUPERVISOR_ZERO_CODE_EDITS" && !r.compliant,
  ).length;
  const testRunViolations = results.filter(
    (r) => r.invariant === "SUPERVISOR_ZERO_TEST_RUNS" && !r.compliant,
  ).length;

  // Socratic Memory Health Sub-Report
  let socraticIntact = true;
  let unfulfilledCount = 0;
  let unjustifiedCount = 0;
  let deadlockedImpassesCount = 0;

  if (ctx.socraticMemory instanceof HistoricalDebateMemory) {
    const unfulfilled = ctx.socraticMemory.getUnfulfilledCommitments();
    unfulfilledCount = unfulfilled.length;
    unjustifiedCount = unfulfilled.filter(
      (c: StrategicCommitment) => !c.justification || c.justification.trim().length === 0,
    ).length;
    socraticIntact = unjustifiedCount === 0;
  }

  // Supersession Indexing Health Sub-Report
  let acyclic = true;
  let nodeCount = 0;
  let cycleCount = 0;

  if (ctx.supersessionIndex instanceof SupersessionIndex) {
    const val = ctx.supersessionIndex.validateLineageAcyclicity();
    acyclic = val.valid;
    nodeCount = ctx.supersessionIndex.size();
    cycleCount = val.cycles.length;
  }

  // Suspended Animation Health Sub-Report
  let activeSuspension = false;
  let snapshotChecksumValid: boolean | undefined;
  let snapshotDagAcyclic: boolean | undefined;

  if (ctx.suspendedSnapshot) {
    activeSuspension = true;
    snapshotChecksumValid = verifySnapshotIntegrity(ctx.suspendedSnapshot);
    snapshotDagAcyclic = validateTaskDagAcyclicity(ctx.suspendedSnapshot.tasksDag).valid;
  }

  return {
    healthy: !hasErrors,
    runRoot,
    timestamp: new Date(nowMs).toISOString(),
    invariantsChecked: results.length,
    violationsCount: findings.length,
    invariantResults: Object.freeze(results),
    findings: Object.freeze(findings),
    executiveDashboardStatus: {
      present: dashboardPresent,
      stale: dashboardStale,
      latencyMs: dashboardLatencyMs,
      balanced: dashboardBalanced,
      balanceStatus: dashboardBalanceStatus,
    },
    supervisoryPurity: {
      pure: codeEditViolations === 0 && testRunViolations === 0,
      codeEditViolationsCount: codeEditViolations,
      testRunViolationsCount: testRunViolations,
    },
    socraticMemoryHealth: {
      intact: socraticIntact,
      unfulfilledCommitmentsCount: unfulfilledCount,
      unjustifiedCommitmentsCount: unjustifiedCount,
      deadlockedImpassesCount: deadlockedImpassesCount,
    },
    supersessionIndexingHealth: {
      acyclic,
      nodeCount,
      cycleCount,
    },
    suspendedAnimationHealth: {
      intact: snapshotChecksumValid !== false && snapshotDagAcyclic !== false,
      activeSuspension,
      checksumValid: snapshotChecksumValid,
      dagAcyclic: snapshotDagAcyclic,
    },
  };
}
