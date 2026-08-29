/**
 * Table Builders for Unified Run Reports
 */
import { formatTable } from "../../cli/formatters/line-limiter.ts";
import type {
  DecisionAuditRow,
  ImplementerValidatorTrackingRow,
  LeaseMatrixRow,
  UnifiedAgentRow,
} from "./types.ts";

export function buildAgentMatrixTable(agentRows: readonly UnifiedAgentRow[]): string[] {
  if (agentRows.length === 0) {
    return ["*No active agents registered in this run.*"];
  }
  const headers = [
    "Agent ID",
    "Lifecycle Tier",
    "Role",
    "Status",
    "Task / Attempt",
    "Lease Deadline",
  ];
  const rows = agentRows.map((a) => [
    `\`${a.agentId}\``,
    `Tier ${a.tier}`,
    a.role,
    a.status,
    a.taskId ? `\`${a.taskId}\` (#${a.attempt ?? 1})` : "—",
    a.expiresAt ?? "—",
  ]);
  return formatTable(headers, rows);
}

export function buildLeasesTable(leases: readonly LeaseMatrixRow[]): string[] {
  if (leases.length === 0) {
    return ["*No active leases found.*"];
  }
  const headers = ["Task ID", "Agent ID", "Role", "Attempt", "Status", "Expires At"];
  const rows = leases.map((r) => [
    `\`${r.taskId}\``,
    `\`${r.agentId}\``,
    r.role,
    `#${r.attempt}`,
    r.status,
    r.expiresAt ?? "—",
  ]);
  return formatTable(headers, rows);
}

export function buildDecisionsTable(decisions: readonly DecisionAuditRow[]): string[] {
  if (decisions.length === 0) {
    return ["*No authority decisions recorded.*"];
  }
  const headers = ["Requirement ID", "Decision", "Actor", "Timestamp", "Rationale"];
  const rows = decisions.map((d) => [
    `\`${d.requirementId}\``,
    d.decision.toUpperCase(),
    `\`${d.actor}\``,
    d.timestamp ?? "—",
    d.rationale,
  ]);
  return formatTable(headers, rows);
}

export function buildImplementerValidatorTrackingTable(
  trackingRows: readonly ImplementerValidatorTrackingRow[],
): string[] {
  if (trackingRows.length === 0) {
    return ["*No active lane tasks tracked.*"];
  }
  const headers = [
    "Task ID / Lane",
    "Implementer ──► Validator",
    "Feedback Rounds",
    "Adversarial Probes",
    "Micro-Cycles",
    "Coordinator & Leases",
  ];
  const rows = trackingRows.map((r) => [
    `\`${r.taskId}\` (${r.lane})`,
    `\`${r.implementerId}\` ──► \`${r.validatorId}\``,
    r.pushes,
    r.probes,
    r.microCycles,
    `${r.coordinator} [${r.leaseTimer}]`,
  ]);
  return formatTable(headers, rows);
}

export function buildTaskTopologyTable(
  tasks: readonly {
    id: string;
    label?: string;
    status: string;
    gate?: string;
    write_scope?: readonly string[];
  }[],
): string[] {
  const headers = ["Task ID", "Label", "Status", "Gate", "Write Scope"];
  const rows = tasks.map((t) => [
    `\`${t.id}\``,
    typeof t.label === "string" ? t.label : t.id,
    t.status,
    typeof t.gate === "string" ? `\`${t.gate}\`` : "—",
    Array.isArray(t.write_scope) ? t.write_scope.map((s) => `\`${s}\``).join(", ") : "—",
  ]);
  return formatTable(headers, rows);
}
