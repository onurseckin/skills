import type {
  SubagentNode,
  SugiyamaDag,
  SugiyamaNode,
  SugiyamaNodeBadge,
  SugiyamaSubtask,
} from "./types.ts";

export function getNodeStatusGlyph(status: string, hasDeps = false): string {
  const s = status.toLowerCase();
  if (s === "pass" || s === "done" || s === "satisfied" || s === "passed" || s === "completed") return "✓";
  if (s === "active" || s === "leased" || s === "running" || s === "in_progress") return "●";
  if (s === "probing" || s === "probe" || s === "investigating") return "🔍";
  if (s === "repairing" || s === "repair" || s === "remediation" || s === "changes_requested") return "⟳";
  if (s === "validating") return "🔄";
  if (s === "validated") return "🟣";
  if (s === "ready" || s === "retry_ready") return "○";
  if (s === "failed" || s === "rejected" || s === "escalated" || s === "error") return "✗";
  return s === "draft" ? (hasDeps ? "⏳" : "○") : "⏳";
}

export function formatNodeBadges(task: SugiyamaNode): string {
  const parts: string[] = [];
  const badge = "badge" in task && typeof task.badge === "object" && task.badge !== null ? (task.badge as SugiyamaNodeBadge) : undefined;
  const role = task.assignedRole?.toLowerCase();
  const implementerId = task.implementerAgent?.trim() || badge?.implementerId?.trim() || (role !== "validator" && role !== "coordinator" ? task.assignedAgent?.trim() : undefined) || undefined;
  const validatorId = task.validatorAgent?.trim() || task.validatorId?.trim() || badge?.validatorId?.trim() || (role === "validator" ? task.assignedAgent?.trim() : undefined) || undefined;
  const coordinatorId = task.coordinatorId?.trim() || badge?.coordinatorId?.trim() || (role === "coordinator" ? task.assignedAgent?.trim() : undefined) || undefined;

  if (implementerId) parts.push(`[I: ${implementerId}]`);
  if (validatorId) parts.push(`[V: ${validatorId}]`);
  if (coordinatorId) parts.push(`[C: ${coordinatorId}]`);

  const round = task.round ?? badge?.repairRound;
  const probeRound = task.probeRound ?? task.probes ?? badge?.probeRound;

  if (round !== undefined && probeRound !== undefined) {
    parts.push(`[R${round} P${probeRound}]`);
  } else if (round !== undefined) {
    parts.push(`[R${round}]`);
  } else if (probeRound !== undefined) {
    parts.push(`[P${probeRound}]`);
  }

  const work = typeof task.effort === "number" ? task.effort : typeof badge?.effort === "number" ? badge.effort : 1;
  const span = typeof task.criticalDepth === "number" ? task.criticalDepth + 1 : typeof badge?.span === "number" ? badge.span : 1;
  parts.push(`W:${work} S:${span}`);
  return parts.join(" ");
}

export function getStatusBadge(status: string, hasDeps = false): string {
  const s = status.toLowerCase();
  if (s === "pass") return "✓ PASS";
  if (s === "done" || s === "satisfied" || s === "passed" || s === "completed") return "✓ PASSED";
  if (s === "active") return "● ACTIVE";
  if (s === "leased" || s === "running" || s === "in_progress") return "🟢 RUNNING";
  if (s === "probing" || s === "probe" || s === "investigating") return "🔍 PROBING";
  if (s === "repairing" || s === "repair" || s === "remediation") return "⟳ REPAIRING";
  if (s === "changes_requested") return "🔴 CHANGES_REQ";
  if (s === "validating") return "🔄 VALIDATING";
  if (s === "validated") return "🟣 VALIDATED";
  if (s === "ready" || s === "retry_ready") return "○ READY";
  if (s === "draft") return hasDeps ? "⏳ BLOCKED" : "○ READY";
  if (s === "failed" || s === "rejected") return "❌ REJECTED";
  if (s === "escalated") return "🚨 ESCALATED";
  return "⏳ BLOCKED";
}

export function getStatusGlyph(status: string, hasDeps = false): string {
  return `(${getStatusBadge(status, hasDeps)})`;
}

export function formatStatusBadge(status: string, hasDeps = false): string {
  const s = status.toLowerCase();
  if (s === "active" || s === "leased" || s === "running" || s === "in_progress") return "[● ACTIVE]";
  if (s === "pass" || s === "done" || s === "satisfied" || s === "passed" || s === "completed") return "[✓ PASS]";
  if (s === "ready" || s === "retry_ready") return "[○ READY]";
  if (s === "repairing" || s === "repair" || s === "changes_requested" || s === "remediation") return "[⟳ REPAIRING]";
  if (s === "probing" || s === "probe" || s === "investigating") return "[🔍 PROBING]";
  if (s === "validating") return "[🔄 VALIDATING]";
  if (s === "validated") return "[🟣 VALIDATED]";
  if (s === "failed" || s === "rejected") return "[❌ REJECTED]";
  if (s === "escalated") return "[🚨 ESCALATED]";
  return s === "draft" ? (hasDeps ? "[⏳ BLOCKED]" : "[○ READY]") : "[⏳ BLOCKED]";
}

export function formatSubagentAllocation(
  implementerId?: string | null,
  validatorId?: string | null,
  implementerRole = "IMPLEMENTER",
): string {
  const cleanImpl = implementerId?.trim();
  const cleanVal = validatorId?.trim();
  if (cleanImpl && cleanVal) {
    return `[● ${implementerRole.toUpperCase()}: ${cleanImpl} ──► VALIDATOR: ${cleanVal}]`;
  }
  if (cleanImpl) return `[● ${implementerRole.toUpperCase()}: ${cleanImpl}]`;
  if (cleanVal) return `[● VALIDATOR: ${cleanVal}]`;
  return "";
}

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
    return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed : `[${trimmed}]`;
  }
  if (coordinates && typeof coordinates === "object") {
    const wave = coordinates.wave ?? (coordinates.rank !== undefined ? coordinates.rank + 1 : 1);
    const lane = coordinates.lane ?? (coordinates.order !== undefined ? coordinates.order + 1 : 1);
    return `[W${wave}:L${lane}]`;
  }
  if (waveFallback !== undefined || laneFallback !== undefined) {
    return `[W${waveFallback ?? 1}:L${laneFallback ?? 1}]`;
  }
  return "";
}

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

export function renderSubagentExpandedItems(
  subtasks: readonly (SugiyamaNode | SugiyamaSubtask | string)[],
  branchId?: string,
  depth = 0,
): string[] {
  const rows: string[] = [];
  const indent = "  ".repeat(depth);
  const branchHeader = branchId
    ? `${indent}↳ Dynamic Branch [${branchId}] (${subtasks.length} sub-tasks):`
    : `${indent}↳ Dynamic Sub-tasks (${subtasks.length}):`;
  rows.push(branchHeader);

  for (let i = 0; i < subtasks.length; i++) {
    const sub = subtasks[i];
    if (!sub) continue;
    const connector = i === subtasks.length - 1 ? `${indent}  └──►` : `${indent}  ├──►`;

    if (typeof sub === "string") {
      rows.push(`${connector} [${sub}]`);
    } else {
      const subId = sub.id;
      const subStatus = formatStatusBadge(sub.status ?? "ready");
      const subRole = "assignedRole" in sub && typeof sub.assignedRole === "string" ? sub.assignedRole : "role" in sub && typeof sub.role === "string" ? sub.role : undefined;
      const subImpl = "assignedAgent" in sub && subRole !== "validator" ? sub.assignedAgent : "implementerAgent" in sub && typeof sub.implementerAgent === "string" ? sub.implementerAgent : null;
      const subVal = "validatorId" in sub && typeof sub.validatorId === "string" ? sub.validatorId : "validatorAgent" in sub && typeof sub.validatorAgent === "string" ? sub.validatorAgent : "assignedAgent" in sub && subRole === "validator" ? sub.assignedAgent : null;
      const childAlloc = formatSubagentAllocation(subImpl, subVal, subRole ?? "IMPLEMENTER");
      const allocSuffix = childAlloc ? ` ${childAlloc}` : "";
      rows.push(`${connector} [${subId}] ${subStatus}${allocSuffix}`);

      if ("expandedSubtasks" in sub && Array.isArray(sub.expandedSubtasks) && sub.expandedSubtasks.length > 0) {
        const nested = renderSubagentExpandedItems(
          sub.expandedSubtasks as readonly (SugiyamaNode | SugiyamaSubtask | string)[],
          "branchId" in sub && typeof sub.branchId === "string" ? sub.branchId : undefined,
          depth + 1,
        );
        rows.push(...nested);
      }
    }
  }
  return rows;
}

export function expandSubagentSubgraphs(
  dag: SugiyamaDag,
  subagents: readonly SubagentNode[],
): SugiyamaDag {
  if (subagents.length === 0) return dag;

  const subagentsByParent = new Map<string, SubagentNode[]>();
  for (const sa of subagents) {
    const parentId = sa.parentTaskId;
    if (parentId) {
      const list = subagentsByParent.get(parentId);
      if (list) list.push(sa);
      else subagentsByParent.set(parentId, [sa]);
    }
  }

  const updatedNodes: SugiyamaNode[] = dag.nodes.map((node) => {
    const matchingSubagents = subagentsByParent.get(node.id);
    if (!matchingSubagents || matchingSubagents.length === 0) return node;

    const convertedSubtasks: SugiyamaSubtask[] = matchingSubagents.map((sa) => ({
      id: sa.id,
      label: sa.label,
      status: sa.status ?? "ready",
      assignedAgent: sa.assignedAgent,
      validatorAgent: sa.validatorAgent,
      validatorId: sa.validatorId,
      implementerAgent: sa.implementerAgent,
      role: sa.role,
      writeScope: sa.writeScope,
    }));

    const existingExpanded = node.expandedSubtasks ?? [];
    return {
      ...node,
      expandedSubtasks: [...existingExpanded, ...convertedSubtasks],
    };
  });

  return { nodes: updatedNodes, edges: dag.edges };
}
