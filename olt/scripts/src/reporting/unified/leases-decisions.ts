import { enforceLineLimit, formatTable } from "../../cli/formatters/line-limiter.ts";
import { loadRun } from "../../engine/store/index.ts";
import { isRecord } from "../../requirements/predicates.ts";
import type { TaskRecord, WorkflowState } from "../../workflow/types.ts";
import { extractLeaseAgentId } from "../lease-agent-extractor.ts";
import type { DecisionAuditRow, LeaseMatrixRow, LeaseRecord } from "./types.ts";

export function formatLeaseDecisions(leases: readonly (LeaseRecord | LeaseMatrixRow)[]): string {
  if (leases.length === 0) {
    return "*No active leases found.*";
  }
  const headers = [
    "Task ID",
    "Agent ID",
    "Role",
    "Attempt",
    "Status",
    "Feedback / Verdict",
    "Expires At",
  ];
  const rows = leases.map((r) => {
    const feedback = r.verdict
      ? `Verdict: ${r.verdict}`
      : r.pushes !== undefined || r.probes !== undefined
        ? `Pushes: ${r.pushes ?? 0}/5, Probes: ${r.probes ?? 0}/5`
        : "—";
    return [
      `\`${r.taskId}\``,
      `\`${r.agentId}\``,
      r.role,
      `#${r.attempt}`,
      r.status,
      feedback,
      r.expiresAt ?? "—",
    ];
  });
  return formatTable(headers, rows).join("\n");
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
