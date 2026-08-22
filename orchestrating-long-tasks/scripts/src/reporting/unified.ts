import { dirname } from "node:path";
import { loadRun } from "../store/index.ts";
import type { TaskRecord, WorkflowState } from "../workflow/types.ts";
import { enforceLineLimit, formatTable } from "../cli/formatters/line-limiter.ts";
import { isRecord } from "../requirements/predicates.ts";
import { getHarnessConfig } from "../config/harness-config.ts";
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

export {
  extractLeaseAgentId,
  extractLeaseRole,
  extractLeaseAttempt,
  type LeaseRecordView,
};

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
    active: Array<{ taskId: string; agentId: string; role: string; attempt: number; expiresAt: string }>;
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
      const role = typeof t.lease.role === "string" && t.lease.role.length > 0 ? t.lease.role : "implementer";
      const attempt = typeof t.lease.attempt === "number" ? t.lease.attempt : 1;
      const issuedAt = typeof t.lease.issued_at === "string" ? t.lease.issued_at : undefined;
      const expiresAt = typeof t.lease.expires_at === "string" ? t.lease.expires_at : undefined;
      const heartbeatAt = typeof t.lease.heartbeat_at === "string" ? t.lease.heartbeat_at : undefined;

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
        const role = typeof sub.lease.role === "string" && sub.lease.role.length > 0 ? sub.lease.role : "sub_implementer";
        const attempt = typeof sub.lease.attempt === "number" ? sub.lease.attempt : 1;
        const issuedAt = typeof sub.lease.issued_at === "string" ? sub.lease.issued_at : undefined;
        const expiresAt = typeof sub.lease.expires_at === "string" ? sub.lease.expires_at : undefined;
        const heartbeatAt = typeof sub.lease.heartbeat_at === "string" ? sub.lease.heartbeat_at : undefined;

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

  const harnessConfig = getHarnessConfig(dirname(dirname(loaded.runRoot)), loaded.runRoot);
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
          role: typeof t.lease.role === "string" && t.lease.role.length > 0 ? t.lease.role : "repairer",
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
          role: typeof t.lease.role === "string" && t.lease.role.length > 0 ? t.lease.role : "implementer",
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
      const role = typeof a.role === "string" ? a.role : agentIdToRole(agentId) ?? "unknown";
      const tier = (typeof a.tier === "number"
        ? a.tier
        : agentIdToTier(agentId) ?? roleToTier(role)) as ExecutionTier;
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

  // Markdown Construction
  const mdSections: string[] = [
    `### Unified Run Report & Telemetry: \`${runId}\``,
    `- **Phase**: ${phase} | **Total Tasks**: ${tasks.length} | **Progress**: ${satisfiedTaskIds.length}/${tasks.length} Satisfied`,
    `- **Occupancy**: ${occupancySummary}`,
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
      validatorsActive.map((v) => `\`${v.taskId}\` (\`${v.validatorId}\` [${v.domain}])`).join(", ") ||
        "none",
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

  mdSections.push("");
  mdSections.push("#### 3. Task Topology & Write Scope Matrix");
  const taskHeaders = ["Task ID", "Label", "Status", "Gate", "Write Scope"];
  const taskTableRows = tasks.map((t) => [
    `\`${t.id}\``,
    typeof t.label === "string" ? t.label : t.id,
    t.status,
    typeof t.gate === "string" ? `\`${t.gate}\`` : "—",
    Array.isArray(t.write_scope) ? t.write_scope.map((s) => `\`${s}\``).join(", ") : "—",
  ]);
  mdSections.push(...formatTable(taskHeaders, taskTableRows));

  if (options.detailed) {
    if (decisions.length > 0) {
      mdSections.push("");
      mdSections.push("#### 4. Authority Decisions & Governance Audit");
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
  const markdown = enforceLineLimit(fullMarkdown, 120);

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
  };
}
