/**
 * Markdown Section Generators for Unified Run Reports
 */
import { formatTable } from "../../cli/formatters/line-limiter.ts";
import {
  buildAgentMatrixTable,
  buildImplementerValidatorTrackingTable,
  buildTaskTopologyTable,
} from "./table-builder.ts";
import type {
  CoordinatorOwnershipMetrics,
  DecisionAuditRow,
  ImplementerValidatorTrackingRow,
  SugiyamaDagReport,
  UnifiedAgentRow,
} from "./types.ts";

export interface UnifiedSectionData {
  readonly runId: string;
  readonly phase: string;
  readonly totalTasks: number;
  readonly satisfiedCount: number;
  readonly occupancySummary: string;
  readonly doctorHealthy: boolean;
  readonly bunSupported: boolean;
  readonly gitignored: boolean | null;
  readonly doctorCriticalIssues: readonly string[];
  readonly doctorCosmeticIssues: readonly string[];
  readonly agentRows: readonly UnifiedAgentRow[];
  readonly implementersActive: readonly {
    taskId: string;
    agentId: string;
    role: string;
    attempt: number;
    expiresAt: string;
  }[];
  readonly validatorsActive: readonly {
    taskId: string;
    validatorId: string;
    domain: string;
    deadlineAt: string;
  }[];
  readonly submittedTaskIds: readonly string[];
  readonly standbyTaskIds: readonly string[];
  readonly blockedTaskIds: readonly string[];
  readonly satisfiedTaskIds: readonly string[];
  readonly repairTaskIds: readonly string[];
  readonly sugiyamaReport: SugiyamaDagReport;
  readonly tasks: readonly {
    id: string;
    label?: string;
    status: string;
    gate?: string;
    write_scope?: readonly string[];
  }[];
  readonly trackingRows: readonly ImplementerValidatorTrackingRow[];
  readonly coordinatorMetrics: CoordinatorOwnershipMetrics;
  readonly decisions: readonly DecisionAuditRow[];
  readonly detailed?: boolean | undefined;
}

export function buildUnifiedReportMarkdown(data: UnifiedSectionData): string {
  const mdSections: string[] = [
    `### Unified Run Report & Telemetry: \`${data.runId}\``,
    `- **Phase**: ${data.phase} | **Total Tasks**: ${data.totalTasks} | **Progress**: ${data.satisfiedCount}/${data.totalTasks} Satisfied`,
    `- **Occupancy**: ${data.occupancySummary}`,
    `- **Doctor Health**: ${data.doctorHealthy ? "✅ Healthy" : "⚠️ Issues Detected"} | **Bun**: ${Bun.version} (${data.bunSupported ? "supported" : "unsupported"}) | **Gitignored**: ${data.gitignored === true ? "yes" : data.gitignored === false ? "no" : "unknown"}`,
    `- **Coordinator Ownership**: \`${data.coordinatorMetrics.coordinatorId}\` (${data.coordinatorMetrics.ownershipPct}%) | **Active Leases**: ${data.coordinatorMetrics.activeLeaseTimers.length}`,
    `- **DAG Execution**: ${data.sugiyamaReport.metrics.totalWaves} wave(s), ${data.sugiyamaReport.metrics.criticalPathLength} critical path depth, Work/Span (P)=${data.sugiyamaReport.metrics.parallelismFactor}`,
    "",
    "#### 1. Lifecycle Tier & Active Agent Breakdown",
    ...buildAgentMatrixTable(data.agentRows),
    "",
    "#### 2. Implementer-Validator Lane Tracking & Feedback Flow",
    ...buildImplementerValidatorTrackingTable(data.trackingRows),
    "",
    "#### 3. Distinct Lifecycle Phase Status",
  ];

  const phaseHeaders = ["Phase Lane", "Active Count", "Task Identifiers / Details"];
  const phaseRows = [
    [
      "🏃 Implementers (Coding)",
      String(data.implementersActive.length),
      data.implementersActive.map((i) => `\`${i.taskId}\` (\`${i.agentId}\`)`).join(", ") || "none",
    ],
    [
      "🔄 Validators (Testing/Probing)",
      String(data.validatorsActive.length),
      data.validatorsActive
        .map((v) => `\`${v.taskId}\` (\`${v.validatorId}\` [${v.domain}])`)
        .join(", ") || "none",
    ],
    [
      "📦 Submitted (Awaiting Validation)",
      String(data.submittedTaskIds.length),
      data.submittedTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
    [
      "🟢 Standby (Ready to Claim)",
      String(data.standbyTaskIds.length),
      data.standbyTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
    [
      "🛠️ Repair (Changes Requested)",
      String(data.repairTaskIds.length),
      data.repairTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
    [
      "⏳ Blocked (Prerequisites Pending)",
      String(data.blockedTaskIds.length),
      data.blockedTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
    [
      "✅ Satisfied (Validated Green)",
      String(data.satisfiedTaskIds.length),
      data.satisfiedTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
  ];
  mdSections.push(...formatTable(phaseHeaders, phaseRows));

  if (data.tasks.length > 0) {
    mdSections.push("");
    mdSections.push("#### 4. Live Sugiyama Hierarchical DAG");
    mdSections.push("```text");
    mdSections.push(data.sugiyamaReport.renderedDag);
    mdSections.push("```");
  }

  mdSections.push("");
  mdSections.push("#### 5. Live Doctor Diagnostics & System Integrity");
  mdSections.push(`- **Healthy**: ${data.doctorHealthy ? "yes" : "no"}`);
  mdSections.push(`- **Bun**: ${Bun.version} (${data.bunSupported ? "supported" : "unsupported"})`);
  mdSections.push(
    `- **Gitignored**: ${data.gitignored === true ? "yes" : data.gitignored === false ? "no" : "unknown"}`,
  );
  mdSections.push(
    `- **Supervisory Invariants**: Strict Tier Hierarchy & Supervisor Zero-File-Edit Rule actively enforced`,
  );

  if (data.doctorCriticalIssues.length > 0) {
    mdSections.push("- **Critical Issues**:");
    for (const issue of data.doctorCriticalIssues) {
      mdSections.push(`  - ${issue}`);
    }
  } else {
    mdSections.push("- **Critical Issues**: none");
  }

  if (data.doctorCosmeticIssues.length > 0) {
    mdSections.push("- **Notices** (cosmetic — do not affect Healthy):");
    for (const issue of data.doctorCosmeticIssues) {
      mdSections.push(`  - ${issue}`);
    }
  }

  mdSections.push("");
  mdSections.push("#### 6. Task Topology & Write Scope Matrix");
  mdSections.push(...buildTaskTopologyTable(data.tasks));

  mdSections.push("");
  mdSections.push("#### 7. Task Rollup & Concurrency Metrics");
  mdSections.push(
    `- **Waves**: ${data.sugiyamaReport.metrics.totalWaves} | **Max Parallel Lanes**: ${data.sugiyamaReport.metrics.maxParallelLanes} | **Critical Path**: ${data.sugiyamaReport.metrics.criticalPathLength}`,
  );
  mdSections.push(
    `- **Work/Span Ratio (P)**: ${data.sugiyamaReport.metrics.parallelismFactor} (Work=${data.sugiyamaReport.metrics.totalWork}, Span=${data.sugiyamaReport.metrics.span}) | **Optimal Concurrency**: ${data.sugiyamaReport.metrics.optimalConcurrency}`,
  );

  if (data.detailed && data.decisions.length > 0) {
    mdSections.push("");
    mdSections.push("#### 8. Authority Decisions & Governance Audit");
    const decHeaders = ["Requirement ID", "Decision", "Actor", "Timestamp", "Rationale"];
    const decRows = data.decisions.map((d) => [
      `\`${d.requirementId}\``,
      d.decision.toUpperCase(),
      `\`${d.actor}\``,
      d.timestamp ?? "—",
      d.rationale,
    ]);
    mdSections.push(...formatTable(decHeaders, decRows));
  }

  return mdSections.join("\n");
}
