/**
 * Sugiyama Subagent Expansion & Visual Badges Engine
 * Handles implementer-validator allocations, coordinate formatting, and hierarchical subagent nesting.
 */
import type { SugiyamaNode, SugiyamaSubtask } from "./types.ts";

/**
 * Returns live status badge and glyph.
 */
export function getStatusBadge(status: string, hasDeps = false): string {
  switch (status.toLowerCase()) {
    case "pass":
      return "✓ PASS";
    case "done":
    case "satisfied":
    case "passed":
      return "✓ PASSED";
    case "active":
      return "● ACTIVE";
    case "leased":
    case "running":
      return "🟢 RUNNING";
    case "probing":
    case "probe":
    case "investigating":
      return "🔍 PROBING";
    case "repairing":
    case "repair":
    case "remediation":
      return "⟳ REPAIRING";
    case "validating":
      return "🔄 VALIDATING";
    case "validated":
      return "🟣 VALIDATED";
    case "ready":
    case "retry_ready":
      return "○ READY";
    case "draft":
      return hasDeps ? "⏳ BLOCKED" : "○ READY";
    case "changes_requested":
      return "🔴 CHANGES_REQ";
    case "failed":
    case "rejected":
      return "❌ REJECTED";
    case "escalated":
      return "🚨 ESCALATED";
    case "proposed":
    case "blocked":
    default:
      return "⏳ BLOCKED";
  }
}

export function getStatusGlyph(status: string, hasDeps = false): string {
  return `(${getStatusBadge(status, hasDeps)})`;
}

/**
 * Returns boxed bracket status badges for dynamic DAG visualization.
 * Supported badges: [● ACTIVE], [✓ PASS], [○ READY], [⟳ REPAIRING], [🔍 PROBING], etc.
 */
export function formatStatusBadge(status: string, hasDeps = false): string {
  switch (status.toLowerCase()) {
    case "active":
    case "leased":
    case "running":
    case "in_progress":
      return "[● ACTIVE]";
    case "pass":
    case "done":
    case "satisfied":
    case "passed":
      return "[✓ PASS]";
    case "ready":
    case "retry_ready":
      return "[○ READY]";
    case "repairing":
    case "repair":
    case "changes_requested":
    case "remediation":
      return "[⟳ REPAIRING]";
    case "probing":
    case "probe":
    case "investigating":
      return "[🔍 PROBING]";
    case "validating":
      return "[🔄 VALIDATING]";
    case "validated":
      return "[🟣 VALIDATED]";
    case "failed":
    case "rejected":
      return "[❌ REJECTED]";
    case "escalated":
      return "[🚨 ESCALATED]";
    case "proposed":
    case "blocked":
      return "[⏳ BLOCKED]";
    case "draft":
    default:
      return hasDeps ? "[⏳ BLOCKED]" : "[○ READY]";
  }
}

/**
 * Formats subagent allocation relationship string:
 * [● IMPLEMENTER: <agent-id> ──► VALIDATOR: <agent-id>]
 */
export function formatSubagentAllocation(
  implementerId?: string | null,
  validatorId?: string | null,
  implementerRole = "IMPLEMENTER",
): string {
  const cleanImpl = implementerId?.trim();
  const cleanVal = validatorId?.trim();

  if (cleanImpl && cleanVal) {
    const roleUpper = implementerRole.toUpperCase();
    return `[● ${roleUpper}: ${cleanImpl} ──► VALIDATOR: ${cleanVal}]`;
  }
  if (cleanImpl) {
    const roleUpper = implementerRole.toUpperCase();
    return `[● ${roleUpper}: ${cleanImpl}]`;
  }
  if (cleanVal) {
    return `[● VALIDATOR: ${cleanVal}]`;
  }
  return "";
}

/**
 * Formats wave/lane coordinates: [W<wave>:L<lane>]
 */
export function formatCoordinates(
  coordinates?:
    | {
        readonly wave?: number;
        readonly lane?: number;
        readonly rank?: number;
        readonly order?: number;
      }
    | string
    | null,
  waveFallback?: number,
  laneFallback?: number,
): string {
  if (typeof coordinates === "string" && coordinates.trim().length > 0) {
    const trimmed = coordinates.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
    return `[${trimmed}]`;
  }
  if (coordinates && typeof coordinates === "object") {
    const wave = coordinates.wave ?? (coordinates.rank !== undefined ? coordinates.rank + 1 : 1);
    const lane = coordinates.lane ?? (coordinates.order !== undefined ? coordinates.order + 1 : 1);
    return `[W${wave}:L${lane}]`;
  }
  if (waveFallback !== undefined || laneFallback !== undefined) {
    const wave = waveFallback ?? 1;
    const lane = laneFallback ?? 1;
    return `[W${wave}:L${lane}]`;
  }
  return "";
}

/**
 * Formats implementer-validator metrics & tracking lines for node details.
 */
export function formatImplementerValidatorTracking(task: SugiyamaNode): string[] {
  const lines: string[] = [];

  const pushesCount = task.pushes ?? 0;
  const probesCount = task.probes ?? (task.probeRound !== undefined ? task.probeRound : 0);
  const attemptsCount = task.attempt ?? 1;
  const inLeaseRepairsCount = task.inLeaseRepairs ?? (task.round !== undefined && task.round > 1 ? task.round - 1 : 0);

  lines.push(`Tracking: Pushes: ${pushesCount}/5 | Probes: ${probesCount}/5 | Attempts: ${attemptsCount}/3 | In-Lease Repairs: ${inLeaseRepairsCount}/3`);

  if (task.coordinatorId) {
    const pctStr = task.coordinatorOwnershipPct !== undefined ? ` (${task.coordinatorOwnershipPct}%)` : "";
    const leaseTimerStr = task.activeLeaseTimerSeconds !== undefined ? ` | Active Lease Timer: ${task.activeLeaseTimerSeconds}s` : "";
    lines.push(`Coordinator: ${task.coordinatorId}${pctStr}${leaseTimerStr}`);
  }

  return lines;
}

/**
 * Expands hierarchical subagent subtasks into rendered ASCII tree lines.
 */
export function renderSubagentExpandedItems(
  subtasks: readonly (SugiyamaNode | SugiyamaSubtask | string)[],
  branchId?: string,
): string[] {
  const rows: string[] = [];
  const branchHeader = branchId
    ? `↳ Dynamic Branch [${branchId}] (${subtasks.length} sub-tasks):`
    : `↳ Dynamic Sub-tasks (${subtasks.length}):`;
  rows.push(branchHeader);

  for (let i = 0; i < subtasks.length; i++) {
    const sub = subtasks[i];
    if (!sub) continue;
    const isLast = i === subtasks.length - 1;
    const connector = isLast ? "  └──►" : "  ├──►";

    if (typeof sub === "string") {
      rows.push(`${connector} [${sub}]`);
    } else {
      const subId = sub.id;
      const subStatus = formatStatusBadge(sub.status ?? "ready");
      const subRole =
        "assignedRole" in sub && typeof sub.assignedRole === "string"
          ? sub.assignedRole
          : "role" in sub && typeof sub.role === "string"
            ? sub.role
            : undefined;
      const subImpl =
        "assignedAgent" in sub && subRole !== "validator"
          ? sub.assignedAgent
          : "implementerAgent" in sub && typeof sub.implementerAgent === "string"
            ? sub.implementerAgent
            : null;
      const subVal =
        "validatorId" in sub && typeof sub.validatorId === "string"
          ? sub.validatorId
          : "validatorAgent" in sub && typeof sub.validatorAgent === "string"
            ? sub.validatorAgent
            : "assignedAgent" in sub && subRole === "validator"
              ? sub.assignedAgent
              : null;
      const childAlloc = formatSubagentAllocation(subImpl, subVal, subRole ?? "IMPLEMENTER");
      const allocSuffix = childAlloc ? ` ${childAlloc}` : "";
      rows.push(`${connector} [${subId}] ${subStatus}${allocSuffix}`);
    }
  }

  return rows;
}
