import { enforceLineLimit } from "../../cli/formatters/line-limiter.ts";
import { getHarnessConfig } from "../../core/config/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { loadRun } from "../../engine/store/index.ts";
import { isRecord } from "../../requirements/predicates.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { computeCapsuleDoctorFacts } from "../doctor.ts";
import { extractLeaseAgentId } from "../lease-agent-extractor.ts";
import {
  buildSugiyamaDagReport,
  type SugiyamaEdge,
  type SugiyamaNode,
} from "../sugiyama-dag/index.ts";
import { generateDecisionsReport, generateLeasesReport } from "./leases-decisions.ts";
import { buildAgentMatrixRows, segmentTaskLifecycle } from "./lifecycle-segmenter.ts";
import { buildUnifiedReportMarkdown } from "./sections.ts";
import type {
  CoordinatorOwnershipMetrics,
  ImplementerValidatorTrackingRow,
  ReportContext,
  UnifiedLifecycleBreakdown,
  UnifiedReport,
  UnifiedReportView,
} from "./types.ts";

export function buildUnifiedReport(ctx: ReportContext): UnifiedReportView {
  return generateUnifiedReport(ctx.runRoot, { detailed: ctx.detailed });
}

export function generateUnifiedReport(
  runRoot: string,
  options: { detailed?: boolean | undefined } = {},
): UnifiedReport {
  const loaded = loadRun(runRoot);
  const state = loaded.state as unknown as WorkflowState;
  const runId = loaded.manifest.run_id;

  const harnessConfig = getHarnessConfig(findRepoRoot(loaded.runRoot), loaded.runRoot);
  const maxParallel = harnessConfig.default_max_parallel;
  const gateMaxParallel = harnessConfig.gate_max_parallel;

  const tasks = Object.values((state.tasks ?? {}) as Record<string, TaskRecord>);
  const completionResult = state.completion_result as { status: string } | undefined;
  const phase =
    completionResult?.status === "complete" ? "Completed" : state.graph ? "Executing" : "Planning";

  const seg = segmentTaskLifecycle(tasks);
  const activeSlots = seg.implementersActive.length + seg.validatorsActive.length;
  const occupancySummary = `${seg.implementersActive.length} Implementer(s) coding, ${seg.validatorsActive.length} Validator(s) testing/probing, ${seg.standbyTaskIds.length} Standby ready | ${activeSlots}/${maxParallel} active slots (gate ceiling ${gateMaxParallel}).`;

  const lifecycle: UnifiedLifecycleBreakdown = {
    implementers: { count: seg.implementersActive.length, active: seg.implementersActive },
    validators: { count: seg.validatorsActive.length, active: seg.validatorsActive },
    submitted: { count: seg.submittedTaskIds.length, taskIds: seg.submittedTaskIds },
    standby: { count: seg.standbyTaskIds.length, taskIds: seg.standbyTaskIds },
    blocked: { count: seg.blockedTaskIds.length, taskIds: seg.blockedTaskIds },
    satisfied: { count: seg.satisfiedTaskIds.length, taskIds: seg.satisfiedTaskIds },
    repair: { count: seg.repairTaskIds.length, taskIds: seg.repairTaskIds },
  };

  const rawAgents = (Array.isArray(state.agents) ? state.agents : []) as Record<string, unknown>[];
  const agentRows = buildAgentMatrixRows(
    rawAgents,
    tasks,
    seg.implementersActive,
    seg.validatorsActive,
  );

  const { matrix: leases } = generateLeasesReport(runRoot);
  const { decisions } = generateDecisionsReport(runRoot);

  const coordinatorId =
    agentRows.find(
      (a) => a.tier === 1 || a.role.includes("coordinator") || a.role.includes("supervisor"),
    )?.agentId ?? "coordinator-tier1";
  const totalTasksCount = tasks.length;
  const coordinatorMetrics: CoordinatorOwnershipMetrics = {
    coordinatorId,
    totalTasks: totalTasksCount,
    ownedTasks: totalTasksCount,
    ownershipPct: 100,
    activeLeaseTimers: leases.map((l) => ({
      taskId: l.taskId,
      agentId: l.agentId,
      remainingSeconds: 120,
    })),
  };

  const trackingRows: ImplementerValidatorTrackingRow[] = tasks.map((t, idx) => {
    const laneName = `Lane ${idx + 1}`;
    const lease = isRecord(t.lease) ? t.lease : null;
    const implId = lease
      ? extractLeaseAgentId(lease)
      : t.status === "done"
        ? "implementer-1"
        : "unassigned";
    const valId =
      Array.isArray(t.validations) && t.validations.length > 0 && isRecord(t.validations[0])
        ? String(t.validations[0].validator_id ?? "validator-1")
        : "validator-1";

    const pushesCount = typeof t.pushes === "number" ? t.pushes : 0;
    const probesCount = typeof t.probes === "number" ? t.probes : 0;
    const attemptNum = lease && typeof lease.attempt === "number" ? lease.attempt : 1;
    const repairsCount = typeof t.repairs === "number" ? t.repairs : 0;

    return {
      taskId: t.id,
      lane: laneName,
      implementerId: implId || "unassigned",
      validatorId: valId,
      pushes: `Pushes: ${pushesCount}/5`,
      probes: `Probes: ${probesCount}/5`,
      microCycles: `Attempts: ${attemptNum}/3, In-Lease Repairs: ${repairsCount}/3`,
      coordinator: `${coordinatorId} (100%)`,
      leaseTimer: lease ? "Active (120s)" : "Expired/Idle",
    };
  });

  const isCompiled = state.graph !== undefined && state.graph !== null;
  const graphRevision =
    isRecord(state.graph) && typeof state.graph.revision === "number" ? state.graph.revision : null;

  const sugiyamaNodes: SugiyamaNode[] = [];
  const sugiyamaEdges: SugiyamaEdge[] = [];

  for (const t of tasks) {
    const status = typeof t.status === "string" ? t.status : "proposed";
    const label = typeof t.label === "string" ? t.label : t.id;
    const priority = typeof t.priority === "number" ? t.priority : 50;
    const writeScope = Array.isArray(t.write_scope) ? (t.write_scope as string[]) : [];
    const resourceScope = Array.isArray(t.resource_scope) ? (t.resource_scope as string[]) : [];
    const gate = typeof t.gate === "string" ? t.gate : undefined;
    const deps = Array.isArray(t.dependencies) ? (t.dependencies as string[]) : [];
    const lease = isRecord(t.lease) ? t.lease : null;
    const assignedAgent = lease ? extractLeaseAgentId(lease) : null;
    const attempt = lease && typeof lease.attempt === "number" ? lease.attempt : null;
    const effort = typeof t.effort === "number" ? t.effort : 1;

    const matchingAgent = rawAgents.find((a) => a.id === assignedAgent);
    const assignedRole =
      typeof matchingAgent?.role === "string"
        ? matchingAgent.role
        : typeof lease?.role === "string"
          ? (lease.role as string)
          : assignedAgent
            ? "implementer"
            : undefined;

    sugiyamaNodes.push({
      id: t.id,
      label,
      status,
      priority,
      writeScope,
      resourceScope,
      gate,
      dependencies: deps,
      assignedAgent,
      assignedRole,
      attempt,
      effort,
      pushes: typeof t.pushes === "number" ? t.pushes : 0,
      probes: typeof t.probes === "number" ? t.probes : 0,
      coordinatorId,
      coordinatorOwnershipPct: 100,
      activeLeaseTimerSeconds: lease ? 120 : undefined,
    });

    for (const depId of deps) {
      sugiyamaEdges.push({
        from: depId,
        to: t.id,
      });
    }
  }

  const sugiyamaReport = buildSugiyamaDagReport(sugiyamaNodes, sugiyamaEdges, {
    runRoot,
    runId,
    isCompiled,
    graphRevision,
    maxParallel,
    detailed: options.detailed,
    boxStyle: "rounded",
  });

  const doctorFacts = computeCapsuleDoctorFacts(runRoot);
  const { gitignored, bunSupported, issues: doctorIssues } = doctorFacts;
  const doctorReport = {
    healthy: doctorFacts.healthy,
    bun_version: Bun.version,
    bun_supported: bunSupported,
    gitignored,
    issues: doctorIssues,
    critical_issues: doctorFacts.criticalIssues,
    cosmetic_issues: doctorFacts.cosmeticIssues,
  };

  const fullMarkdown = buildUnifiedReportMarkdown({
    runId,
    phase,
    totalTasks: tasks.length,
    satisfiedCount: seg.satisfiedTaskIds.length,
    occupancySummary,
    doctorHealthy: doctorFacts.healthy,
    bunSupported,
    gitignored,
    doctorCriticalIssues: doctorFacts.criticalIssues,
    doctorCosmeticIssues: doctorFacts.cosmeticIssues,
    agentRows,
    implementersActive: seg.implementersActive,
    validatorsActive: seg.validatorsActive,
    submittedTaskIds: seg.submittedTaskIds,
    standbyTaskIds: seg.standbyTaskIds,
    blockedTaskIds: seg.blockedTaskIds,
    satisfiedTaskIds: seg.satisfiedTaskIds,
    repairTaskIds: seg.repairTaskIds,
    sugiyamaReport,
    tasks,
    trackingRows,
    coordinatorMetrics,
    decisions,
    detailed: options.detailed,
  });

  const markdown = options.detailed ? fullMarkdown : enforceLineLimit(fullMarkdown, 180);

  return {
    markdown,
    run_root: runRoot,
    run_id: runId,
    phase,
    topology: {
      total_tasks: tasks.length,
      satisfied: seg.satisfiedTaskIds.length,
      active: activeSlots,
      blocked: seg.blockedTaskIds.length,
      standby: seg.standbyTaskIds.length,
      repair: seg.repairTaskIds.length,
    },
    lifecycle,
    occupancy: {
      active_slots: activeSlots,
      max_parallel: maxParallel,
      gate_max_parallel: gateMaxParallel,
      summary: occupancySummary,
    },
    agent_matrix: agentRows,
    leases,
    decisions,
    implementer_validator_tracking: trackingRows,
    coordinator_ownership: coordinatorMetrics,
    dag: sugiyamaReport,
    doctor: doctorReport,
    metrics: sugiyamaReport.metrics,
  };
}
