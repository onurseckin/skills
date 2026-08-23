import { dirname } from "node:path";
import { loadRun, verifyCapsuleDeep, verifyIntegrity } from "../store/index.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import { enforceLineLimit, formatTable } from "../cli/formatters/line-limiter.ts";
import { isRecord } from "../requirements/predicates.ts";
import { getHarnessConfig } from "../config/harness-config.ts";
import { findRepoRoot } from "../shared/paths.ts";
import { MINIMUM_BUN_VERSION } from "../config/constants.ts";
import {
  agentIdToRole,
  agentIdToTier,
  roleToTier,
  TIER_NAMES,
  type ExecutionTier,
} from "../authority/thread-identifier.ts";
import {
  extractLeaseAgentId,
  extractLeaseRole,
  extractLeaseAttempt,
  type LeaseRecordView,
} from "./lease-agent-extractor.ts";
import {
  buildSugiyamaDagReport,
  type SugiyamaDagReport,
  type SugiyamaEdge,
  type SugiyamaNode,
  type SugiyamaWaveMetrics,
} from "./sugiyama-dag.ts";
import { ignoredByGit, versionAtLeast } from "./doctor.ts";

export { extractLeaseAgentId, extractLeaseRole, extractLeaseAttempt, type LeaseRecordView };

export interface LeaseMatrixRow {
  taskId: string;
  agentId: string;
  role: string;
  status: string;
  attempt: number;
  issuedAt?: string | undefined;
  expiresAt?: string | undefined;
  heartbeatAt?: string | undefined;
}

export interface DecisionAuditRow {
  requirementId: string;
  decision: string;
  rationale: string;
  actor: string;
  timestamp?: string | undefined;
}

export interface UnifiedAgentRow {
  agentId: string;
  tier: ExecutionTier;
  tierName: string;
  role: string;
  status: string;
  taskId: string | null;
  attempt: number | null;
  issuedAt?: string | undefined;
  expiresAt?: string | undefined;
}

export interface UnifiedLifecycleBreakdown {
  implementers: {
    count: number;
    active: Array<{
      taskId: string;
      agentId: string;
      role: string;
      attempt: number;
      expiresAt: string;
    }>;
  };
  validators: {
    count: number;
    active: Array<{ taskId: string; validatorId: string; domain: string; deadlineAt: string }>;
  };
  submitted: {
    count: number;
    taskIds: string[];
  };
  standby: {
    count: number;
    taskIds: string[];
  };
  blocked: {
    count: number;
    taskIds: string[];
  };
  satisfied: {
    count: number;
    taskIds: string[];
  };
  repair: {
    count: number;
    taskIds: string[];
  };
}

export interface UnifiedReport {
  markdown: string;
  run_root: string;
  run_id: string;
  phase: string;
  topology: {
    total_tasks: number;
    satisfied: number;
    active: number;
    blocked: number;
    standby: number;
    repair: number;
  };
  lifecycle: UnifiedLifecycleBreakdown;
  occupancy: {
    active_slots: number;
    max_parallel: number;
    gate_max_parallel: number;
    summary: string;
  };
  agent_matrix: UnifiedAgentRow[];
  leases: LeaseMatrixRow[];
  decisions: DecisionAuditRow[];
  dag?: SugiyamaDagReport | undefined;
  doctor?:
    | {
        healthy: boolean;
        bun_version: string;
        bun_supported: boolean;
        gitignored: boolean | null;
        issues: readonly string[];
      }
    | undefined;
  metrics?: SugiyamaWaveMetrics | undefined;
}

export function generateLeasesReport(runRoot: string): {
  matrix: LeaseMatrixRow[];
  markdown: string;
} {
  const loaded = loadRun(runRoot);
  const state = loaded.state as unknown as WorkflowState;

  const tasks = Object.values((state.tasks ?? {}) as Record<string, TaskRecord>);
  const branches = state.branches ?? [];
  const matrix: LeaseMatrixRow[] = [];

  for (const t of tasks) {
    if (t.lease) {
      const agentId = extractLeaseAgentId(t.lease) || "unknown";
      const role =
        typeof t.lease.role === "string" && t.lease.role.length > 0 ? t.lease.role : "implementer";
      const attempt = typeof t.lease.attempt === "number" ? t.lease.attempt : 1;
      const issuedAt = typeof t.lease.issued_at === "string" ? t.lease.issued_at : undefined;
      const expiresAt = typeof t.lease.expires_at === "string" ? t.lease.expires_at : undefined;
      const heartbeatAt =
        typeof t.lease.heartbeat_at === "string" ? t.lease.heartbeat_at : undefined;

      matrix.push({
        taskId: String(t.id),
        agentId,
        role,
        status: String(t.status),
        attempt,
        issuedAt,
        expiresAt,
        heartbeatAt,
      });
    }
  }

  for (const b of branches) {
    for (const sub of b.sub_tasks) {
      if (sub.lease) {
        const agentId = extractLeaseAgentId(sub.lease) || "unknown";
        const role =
          typeof sub.lease.role === "string" && sub.lease.role.length > 0
            ? sub.lease.role
            : "sub_implementer";
        const attempt = typeof sub.lease.attempt === "number" ? sub.lease.attempt : 1;
        const issuedAt = typeof sub.lease.issued_at === "string" ? sub.lease.issued_at : undefined;
        const expiresAt =
          typeof sub.lease.expires_at === "string" ? sub.lease.expires_at : undefined;
        const heartbeatAt =
          typeof sub.lease.heartbeat_at === "string" ? sub.lease.heartbeat_at : undefined;

        matrix.push({
          taskId: String(sub.id),
          agentId,
          role,
          status: "open (sub_task)",
          attempt,
          issuedAt,
          expiresAt,
          heartbeatAt,
        });
      }
    }
  }

  matrix.sort((a, b) => a.taskId.localeCompare(b.taskId));

  const headers = ["Task ID", "Agent ID", "Role", "Attempt", "Status", "Expires At"];
  const rows = matrix.map((r) => [
    `\`${r.taskId}\``,
    `\`${r.agentId}\``,
    r.role,
    `#${r.attempt}`,
    r.status,
    r.expiresAt ?? "—",
  ]);

  const lines = [
    `### Active Leases Matrix: \`${loaded.manifest.run_id}\``,
    `- **Total Active Leases**: ${matrix.length}`,
    "",
    ...(matrix.length > 0 ? formatTable(headers, rows) : ["*No active leases found.*"]),
  ];

  return { matrix, markdown: enforceLineLimit(lines.join("\n"), 80) };
}

export function generateDecisionsReport(runRoot: string): {
  decisions: DecisionAuditRow[];
  markdown: string;
} {
  const loaded = loadRun(runRoot);
  const state = loaded.state as unknown as WorkflowState;

  const rawReqs = state.requirements as unknown;
  const requirements: Array<Record<string, unknown>> = Array.isArray(rawReqs)
    ? (rawReqs as Array<Record<string, unknown>>)
    : isRecord(rawReqs) && Array.isArray(rawReqs.requirements)
      ? (rawReqs.requirements as Array<Record<string, unknown>>)
      : [];
  const decisions: DecisionAuditRow[] = [];

  for (const req of requirements) {
    if (Array.isArray(req.authority_history)) {
      for (const entry of req.authority_history) {
        if (isRecord(entry) && typeof entry.decision === "string") {
          decisions.push({
            requirementId: String(req.id),
            decision: entry.decision,
            rationale: typeof entry.rationale === "string" ? entry.rationale : "",
            actor: typeof entry.actor === "string" ? entry.actor : "",
            timestamp: typeof entry.at === "string" ? entry.at : undefined,
          });
        }
      }
    }
  }

  const headers = ["Requirement ID", "Decision", "Actor", "Timestamp", "Rationale"];
  const rows = decisions.map((d) => [
    `\`${d.requirementId}\``,
    d.decision.toUpperCase(),
    `\`${d.actor}\``,
    d.timestamp ?? "—",
    d.rationale,
  ]);

  const lines = [
    `### Authority Decisions Audit: \`${loaded.manifest.run_id}\``,
    `- **Total Decisions**: ${decisions.length}`,
    "",
    ...(decisions.length > 0 ? formatTable(headers, rows) : ["*No authority decisions recorded.*"]),
  ];

  return { decisions, markdown: enforceLineLimit(lines.join("\n"), 80) };
}

export function generateUnifiedReport(
  runRoot: string,
  options: { detailed?: boolean } = {},
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

  // Distinct lifecycle phase segmentation
  const implementersActive: Array<{
    taskId: string;
    agentId: string;
    role: string;
    attempt: number;
    expiresAt: string;
  }> = [];
  const validatorsActive: Array<{
    taskId: string;
    validatorId: string;
    domain: string;
    deadlineAt: string;
  }> = [];
  const submittedTaskIds: string[] = [];
  const standbyTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const satisfiedTaskIds: string[] = [];
  const repairTaskIds: string[] = [];

  for (const t of tasks) {
    if (t.status === "done") {
      satisfiedTaskIds.push(t.id);
    } else if (t.status === "submitted") {
      submittedTaskIds.push(t.id);
    } else if (t.status === "changes_requested") {
      repairTaskIds.push(t.id);
      if (t.lease) {
        implementersActive.push({
          taskId: t.id,
          agentId: extractLeaseAgentId(t.lease) || "unknown",
          role:
            typeof t.lease.role === "string" && t.lease.role.length > 0 ? t.lease.role : "repairer",
          attempt: typeof t.lease.attempt === "number" ? t.lease.attempt : 1,
          expiresAt: typeof t.lease.expires_at === "string" ? t.lease.expires_at : "",
        });
      }
    } else if (t.status === "validating") {
      if (Array.isArray(t.validations)) {
        for (const v of t.validations) {
          if (v.verdict === undefined) {
            validatorsActive.push({
              taskId: t.id,
              validatorId: v.validator_id,
              domain: v.domain,
              deadlineAt: v.deadline_at,
            });
          }
        }
      }
    } else if (t.status === "leased" || t.status === "running") {
      if (t.lease) {
        implementersActive.push({
          taskId: t.id,
          agentId: extractLeaseAgentId(t.lease) || "unknown",
          role:
            typeof t.lease.role === "string" && t.lease.role.length > 0
              ? t.lease.role
              : "implementer",
          attempt: typeof t.lease.attempt === "number" ? t.lease.attempt : 1,
          expiresAt: typeof t.lease.expires_at === "string" ? t.lease.expires_at : "",
        });
      }
    } else if (t.status === "ready") {
      standbyTaskIds.push(t.id);
    } else if (t.status === "proposed") {
      blockedTaskIds.push(t.id);
    }
  }

  const activeSlots = implementersActive.length + validatorsActive.length;
  const occupancySummary = `${implementersActive.length} Implementer(s) coding, ${validatorsActive.length} Validator(s) testing/probing, ${standbyTaskIds.length} Standby ready | ${activeSlots}/${maxParallel} active slots (gate ceiling ${gateMaxParallel}).`;

  const lifecycle: UnifiedLifecycleBreakdown = {
    implementers: { count: implementersActive.length, active: implementersActive },
    validators: { count: validatorsActive.length, active: validatorsActive },
    submitted: { count: submittedTaskIds.length, taskIds: submittedTaskIds },
    standby: { count: standbyTaskIds.length, taskIds: standbyTaskIds },
    blocked: { count: blockedTaskIds.length, taskIds: blockedTaskIds },
    satisfied: { count: satisfiedTaskIds.length, taskIds: satisfiedTaskIds },
    repair: { count: repairTaskIds.length, taskIds: repairTaskIds },
  };

  // Agent Matrix with Lifecycle Tier Breakdown
  const rawAgents = (Array.isArray(state.agents) ? state.agents : []) as Record<string, unknown>[];
  const agentRows: UnifiedAgentRow[] = [];

  for (const a of rawAgents) {
    if (isRecord(a) && typeof a.id === "string") {
      const agentId = a.id;
      const role = typeof a.role === "string" ? a.role : (agentIdToRole(agentId) ?? "unknown");
      const tier = (
        typeof a.tier === "number" ? a.tier : (agentIdToTier(agentId) ?? roleToTier(role))
      ) as ExecutionTier;
      const tierName = TIER_NAMES[tier] ?? `Tier ${tier}`;
      const status = typeof a.status === "string" ? a.status : "active";

      let leasedTaskId: string | null = null;
      let attemptNum: number | null = null;
      let expAt: string | null = null;
      let issAt: string | null = null;

      for (const t of tasks) {
        if (t.lease && extractLeaseAgentId(t.lease) === agentId) {
          leasedTaskId = t.id;
          attemptNum = typeof t.lease.attempt === "number" ? t.lease.attempt : 1;
          expAt = typeof t.lease.expires_at === "string" ? t.lease.expires_at : null;
          issAt = typeof t.lease.issued_at === "string" ? t.lease.issued_at : null;
          break;
        }
      }

      agentRows.push({
        agentId,
        tier,
        tierName,
        role,
        status,
        taskId: leasedTaskId,
        attempt: attemptNum,
        issuedAt: issAt ?? undefined,
        expiresAt: expAt ?? undefined,
      });
    }
  }

  // Also include any active leases not in rawAgents
  for (const imp of implementersActive) {
    if (!agentRows.some((r) => r.agentId === imp.agentId)) {
      const tier = (agentIdToTier(imp.agentId) ?? roleToTier(imp.role)) as ExecutionTier;
      agentRows.push({
        agentId: imp.agentId,
        tier,
        tierName: TIER_NAMES[tier] ?? `Tier ${tier}`,
        role: imp.role,
        status: "active",
        taskId: imp.taskId,
        attempt: imp.attempt,
        expiresAt: imp.expiresAt || undefined,
      });
    }
  }

  for (const val of validatorsActive) {
    if (!agentRows.some((r) => r.agentId === val.validatorId)) {
      const tier = 3 as ExecutionTier;
      agentRows.push({
        agentId: val.validatorId,
        tier,
        tierName: TIER_NAMES[tier] ?? `Tier ${tier}`,
        role: "validator",
        status: "active",
        taskId: val.taskId,
        attempt: 1,
        expiresAt: val.deadlineAt || undefined,
      });
    }
  }

  agentRows.sort((a, b) => a.tier - b.tier || a.agentId.localeCompare(b.agentId));

  const { matrix: leases } = generateLeasesReport(runRoot);
  const { decisions } = generateDecisionsReport(runRoot);

  // Sugiyama Hierarchical DAG Construction
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

  // Live Doctor & Integrity Diagnostics
  const integrityIssues = [...verifyIntegrity(runRoot), ...verifyCapsuleDeep(runRoot)];
  const gitignored = ignoredByGit(runRoot);
  const bunSupported = versionAtLeast(Bun.version, MINIMUM_BUN_VERSION);
  const doctorIssues = [
    ...integrityIssues.map(({ code, message }) => `${code}: ${message}`),
    ...(gitignored === false ? ["run capsule is not gitignored"] : []),
    ...(bunSupported ? [] : [`Bun ${Bun.version} is below ${MINIMUM_BUN_VERSION}`]),
  ];
  const doctorHealthy = doctorIssues.length === 0;
  const doctorReport = {
    healthy: doctorHealthy,
    bun_version: Bun.version,
    bun_supported: bunSupported,
    gitignored,
    issues: doctorIssues,
  };

  // Markdown Construction
  const mdSections: string[] = [
    `### Unified Run Report & Telemetry: \`${runId}\``,
    `- **Phase**: ${phase} | **Total Tasks**: ${tasks.length} | **Progress**: ${satisfiedTaskIds.length}/${tasks.length} Satisfied`,
    `- **Occupancy**: ${occupancySummary}`,
    `- **Doctor Health**: ${doctorHealthy ? "✅ Healthy" : "⚠️ Issues Detected"} | **Bun**: ${Bun.version} (${bunSupported ? "supported" : "unsupported"}) | **Gitignored**: ${gitignored === true ? "yes" : gitignored === false ? "no" : "unknown"}`,
    `- **DAG Execution**: ${sugiyamaReport.metrics.totalWaves} wave(s), ${sugiyamaReport.metrics.criticalPathLength} critical path depth, Work/Span (P)=${sugiyamaReport.metrics.parallelismFactor}`,
    "",
    "#### 1. Lifecycle Tier & Active Agent Breakdown",
  ];

  if (agentRows.length > 0) {
    const agentHeaders = [
      "Agent ID",
      "Lifecycle Tier",
      "Role",
      "Status",
      "Task / Attempt",
      "Lease Deadline",
    ];
    const agentTableRows = agentRows.map((a) => [
      `\`${a.agentId}\``,
      `Tier ${a.tier}`,
      a.role,
      a.status,
      a.taskId ? `\`${a.taskId}\` (#${a.attempt ?? 1})` : "—",
      a.expiresAt ?? "—",
    ]);
    mdSections.push(...formatTable(agentHeaders, agentTableRows));
  } else {
    mdSections.push("*No active agents registered in this run.*");
  }

  mdSections.push("");
  mdSections.push("#### 2. Distinct Lifecycle Phase Status");
  const phaseHeaders = ["Phase Lane", "Active Count", "Task Identifiers / Details"];
  const phaseRows = [
    [
      "🏃 Implementers (Coding)",
      String(implementersActive.length),
      implementersActive.map((i) => `\`${i.taskId}\` (\`${i.agentId}\`)`).join(", ") || "none",
    ],
    [
      "🔄 Validators (Testing/Probing)",
      String(validatorsActive.length),
      validatorsActive
        .map((v) => `\`${v.taskId}\` (\`${v.validatorId}\` [${v.domain}])`)
        .join(", ") || "none",
    ],
    [
      "📦 Submitted (Awaiting Validation)",
      String(submittedTaskIds.length),
      submittedTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
    [
      "🟢 Standby (Ready to Claim)",
      String(standbyTaskIds.length),
      standbyTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
    [
      "🛠️ Repair (Changes Requested)",
      String(repairTaskIds.length),
      repairTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
    [
      "⏳ Blocked (Prerequisites Pending)",
      String(blockedTaskIds.length),
      blockedTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
    [
      "✅ Satisfied (Validated Green)",
      String(satisfiedTaskIds.length),
      satisfiedTaskIds.map((id) => `\`${id}\``).join(", ") || "none",
    ],
  ];
  mdSections.push(...formatTable(phaseHeaders, phaseRows));

  if (sugiyamaNodes.length > 0) {
    mdSections.push("");
    mdSections.push("#### 3. Live Sugiyama Hierarchical DAG");
    mdSections.push("```text");
    mdSections.push(sugiyamaReport.renderedDag);
    mdSections.push("```");
  }

  mdSections.push("");
  mdSections.push("#### 4. Live Doctor Diagnostics & System Integrity");
  mdSections.push(`- **Healthy**: ${doctorHealthy ? "yes" : "no"}`);
  mdSections.push(`- **Bun**: ${Bun.version} (${bunSupported ? "supported" : "unsupported"})`);
  mdSections.push(
    `- **Gitignored**: ${gitignored === true ? "yes" : gitignored === false ? "no" : "unknown"}`,
  );
  mdSections.push(
    `- **Supervisory Invariants**: Strict Tier Hierarchy & Supervisor Zero-File-Edit Rule actively enforced`,
  );
  if (doctorIssues.length > 0) {
    mdSections.push("- **Issues**:");
    for (const issue of doctorIssues) {
      mdSections.push(`  - ${issue}`);
    }
  } else {
    mdSections.push("- **Issues**: none");
  }

  mdSections.push("");
  mdSections.push("#### 5. Task Topology & Write Scope Matrix");
  const taskHeaders = ["Task ID", "Label", "Status", "Gate", "Write Scope"];
  const taskTableRows = tasks.map((t) => [
    `\`${t.id}\``,
    typeof t.label === "string" ? t.label : t.id,
    t.status,
    typeof t.gate === "string" ? `\`${t.gate}\`` : "—",
    Array.isArray(t.write_scope) ? t.write_scope.map((s) => `\`${s}\``).join(", ") : "—",
  ]);
  mdSections.push(...formatTable(taskHeaders, taskTableRows));

  mdSections.push("");
  mdSections.push("#### 6. Task Rollup & Concurrency Metrics");
  mdSections.push(
    `- **Waves**: ${sugiyamaReport.metrics.totalWaves} | **Max Parallel Lanes**: ${sugiyamaReport.metrics.maxParallelLanes} | **Critical Path**: ${sugiyamaReport.metrics.criticalPathLength}`,
  );
  mdSections.push(
    `- **Work/Span Ratio (P)**: ${sugiyamaReport.metrics.parallelismFactor} (Work=${sugiyamaReport.metrics.totalWork}, Span=${sugiyamaReport.metrics.span}) | **Optimal Concurrency**: ${sugiyamaReport.metrics.optimalConcurrency}`,
  );

  if (options.detailed) {
    if (decisions.length > 0) {
      mdSections.push("");
      mdSections.push("#### 7. Authority Decisions & Governance Audit");
      const decHeaders = ["Requirement ID", "Decision", "Actor", "Timestamp", "Rationale"];
      const decRows = decisions.map((d) => [
        `\`${d.requirementId}\``,
        d.decision.toUpperCase(),
        `\`${d.actor}\``,
        d.timestamp ?? "—",
        d.rationale,
      ]);
      mdSections.push(...formatTable(decHeaders, decRows));
    }
  }

  const fullMarkdown = mdSections.join("\n");
  const markdown = options.detailed ? fullMarkdown : enforceLineLimit(fullMarkdown, 180);

  return {
    markdown,
    run_root: runRoot,
    run_id: runId,
    phase,
    topology: {
      total_tasks: tasks.length,
      satisfied: satisfiedTaskIds.length,
      active: activeSlots,
      blocked: blockedTaskIds.length,
      standby: standbyTaskIds.length,
      repair: repairTaskIds.length,
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
    dag: sugiyamaReport,
    doctor: doctorReport,
    metrics: sugiyamaReport.metrics,
  };
}
