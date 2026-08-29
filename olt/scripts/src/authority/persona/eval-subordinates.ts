import { DEFAULT_WATCHDOG_TIMEOUT_MS } from "../watchdog/index.ts";
import { findOverlappingScopes } from "./profiles.ts";
import type { DriftFinding, ReflexiveAuditContext, SubordinateHealthSummary } from "./types.ts";

export function evaluateSubordinateFulfillment(
  context: ReflexiveAuditContext,
  invariantCompliance: Record<string, boolean>,
  findings: DriftFinding[],
  recommendedActions: string[],
): SubordinateHealthSummary {
  const leases = context.activeLeases ?? [];
  const subordinates = context.subordinates ?? [];
  const scopeConflicts = findOverlappingScopes(leases);

  if (scopeConflicts.length > 0) {
    invariantCompliance.write_scope_isolation = false;
    findings.push({
      code: "SUBORDINATE_WRITE_SCOPE_CONFLICT",
      type: "subordinate_fulfillment",
      severity: "high",
      title: "Active Subordinate Write Scope Overlap",
      description: `Detected ${scopeConflicts.length} active write scope collision(s) among concurrently executing tasks: ${scopeConflicts.map((c) => `${c.taskA} vs ${c.taskB} on [${c.overlappingFiles.join(", ")}]`).join("; ")}.`,
      recommendation:
        "Enforce write scope exclusivity. Serialise tasks with overlapping write scopes into successive waves.",
      evidence: { scopeConflicts },
    });
    recommendedActions.push(
      "Re-partition wave dispatches so that tasks touching identical files execute in sequential DAG waves.",
    );
  }

  const staleLeases = leases.filter(
    (l) =>
      l.isStale ||
      (l.heartbeatAgeMs !== undefined && l.heartbeatAgeMs > DEFAULT_WATCHDOG_TIMEOUT_MS),
  );
  const staleSubordinates = subordinates.filter(
    (s) =>
      s.status === "stale" ||
      (s.lastHeartbeatAgeMs !== undefined && s.lastHeartbeatAgeMs > DEFAULT_WATCHDOG_TIMEOUT_MS),
  );

  const totalStaleCount = Math.max(staleLeases.length, staleSubordinates.length);
  if (totalStaleCount > 0) {
    findings.push({
      code: "STALE_SUBORDINATE_HEARTBEAT",
      type: "subordinate_fulfillment",
      severity: "medium",
      title: "Stale Subordinate Leases Detected",
      description: `Found ${totalStaleCount} subordinate agent(s) with stale heartbeats exceeding the timeout threshold (${DEFAULT_WATCHDOG_TIMEOUT_MS / 1000}s).`,
      recommendation:
        "Reclaim stale leases with `task:release` or `task:assign-repairer` to prevent pipeline stalls.",
      evidence: {
        staleLeaseTaskIds: staleLeases.map((l) => l.taskId),
        staleAgentIds: staleSubordinates.map((s) => s.agentId),
      },
    });
    recommendedActions.push(
      "Run `doctor` or `task:release` against stale subordinate leases and dispatch fresh replacement workers.",
    );
  }

  const unreviewedFindings = context.openFindingsCount ?? 0;
  if (unreviewedFindings > 5) {
    findings.push({
      code: "ACCUMULATED_UNREVIEWED_FINDINGS",
      type: "subordinate_fulfillment",
      severity: "medium",
      title: "High Unreviewed Findings Accumulation",
      description: `There are ${unreviewedFindings} open/unresolved findings accumulated across subordinate tasks without synthesis or remediation.`,
      recommendation:
        "Synthesize open findings into task repair assignments or incorporate them into next-round planning prompts.",
      evidence: { unreviewedFindings },
    });
    recommendedActions.push(
      "Triage open findings using `critic:remediate` or fold into next round's planning prompt.",
    );
  }

  return {
    totalSubordinates: Math.max(leases.length, subordinates.length),
    activeCount: Math.max(
      leases.filter((l) => !staleLeases.includes(l)).length,
      subordinates.filter((s) => s.status === "active").length,
    ),
    staleCount: totalStaleCount,
    completedCount: subordinates.filter((s) => s.status === "completed").length,
    conflictingScopeCount: scopeConflicts.length,
    healthy: totalStaleCount === 0 && scopeConflicts.length === 0,
  };
}
