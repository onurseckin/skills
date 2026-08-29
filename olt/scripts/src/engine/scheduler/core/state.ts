import type { GraphHealthAuditReport, GraphHealthIssue, SupervisoryWatchdogAuditReport, TaskRecoveryResult, TaskRecoveryRecord } from "./types.ts";
import { probeOrphanedTasks, probeStaleLeases } from "./tasks.ts";
import { probeCircularDependencies } from "./tasks-circular.ts";
import { probeGateCoverageViolations } from "./tasks-coverage.ts";
import { probeScopeCollisionHazards } from "./tasks-advanced.ts";
import { parseTimestamp, loadWatchdogStore, WatchdogRecord } from "../../../authority/watchdog-manager";
import { TaskStatus } from "../../../core/contracts";
import { transition } from "../../../workflow/task-state";
import { TransactionPort } from "../../../workflow/types";
import { isRecord } from "../../store/layout/layout-json.ts";

export function auditGraphHealth(
  state: unknown,
  options: { now?: Date | string | number | undefined; timeoutMs?: number | undefined } = {},
): GraphHealthAuditReport {
  const orphanedTasks = probeOrphanedTasks(state);
  const staleLeases = probeStaleLeases(state, options);
  const circularDependencies = probeCircularDependencies(state);
  const gateCoverageViolations = probeGateCoverageViolations(state);
  const scopeCollisionHazards = probeScopeCollisionHazards(state);

  const issues: GraphHealthIssue[] = [];

  for (const detail of orphanedTasks.details) {
    issues.push({
      probe: "orphaned_tasks",
      severity: "critical",
      message: detail,
      entityIds: orphanedTasks.orphanedTaskIds,
    });
  }

  for (const detail of staleLeases.details) {
    issues.push({
      probe: "stale_leases",
      severity: "warning",
      message: detail,
      entityIds: staleLeases.staleTaskIds,
    });
  }

  for (const detail of circularDependencies.details) {
    issues.push({
      probe: "circular_dependencies",
      severity: "critical",
      message: detail,
      entityIds: circularDependencies.cycles.flat(),
    });
  }

  for (const detail of gateCoverageViolations.details) {
    issues.push({
      probe: "gate_coverage",
      severity: "critical",
      message: detail,
      entityIds: gateCoverageViolations.tasksWithoutGateCoverage,
    });
  }

  for (const collision of scopeCollisionHazards.activeCollisions) {
    issues.push({
      probe: "scope_collisions",
      severity: "critical",
      message: collision.details,
      entityIds: [collision.leftTaskId, collision.rightTaskId],
    });
  }

  const totalTasks = isRecord(state) && isRecord(state.tasks) ? Object.keys(state.tasks).length : 0;
  const healthy =
    orphanedTasks.passed &&
    circularDependencies.passed &&
    gateCoverageViolations.passed &&
    scopeCollisionHazards.passed &&
    staleLeases.passed;

  return {
    healthy,
    checkedAt: new Date(parseTimestamp(options.now)).toISOString(),
    totalTasks,
    issues,
    probes: {
      orphanedTasks,
      staleLeases,
      circularDependencies,
      gateCoverageViolations,
      scopeCollisionHazards,
    },
  };
}
export function auditSupervisoryWatchdog(
  target?: string | undefined,
  options: { now?: Date | string | number | undefined; timeoutMs?: number | undefined } = {},
): SupervisoryWatchdogAuditReport {
  const store = loadWatchdogStore(target);
  const nowMs = parseTimestamp(options.now);
  const activeWatchdogs: WatchdogRecord[] = [];
  const overdueWatchdogs: WatchdogRecord[] = [];
  const hungAgentIds: string[] = [];
  const issues: string[] = [];

  let staleCount = 0;
  let terminatedCount = 0;
  let orphanedCount = 0;

  const wds = store.watchdogs ?? [];
  for (const wd of wds) {
    if (wd.status === "stale") staleCount++;
    else if (wd.status === "terminated") terminatedCount++;
    else if (wd.status === "orphaned") orphanedCount++;
    else if (wd.status === "active") {
      activeWatchdogs.push(wd);
      const lastHb = parseTimestamp(wd.last_heartbeat_at);
      const timeout = options.timeoutMs ?? wd.timeout_ms;
      if (nowMs - lastHb > timeout) {
        overdueWatchdogs.push(wd);
        if (wd.agent_id) hungAgentIds.push(wd.agent_id);
        issues.push(
          `Watchdog '${wd.id}' (agent '${wd.agent_id ?? "unknown"}') heartbeat overdue by ${nowMs - lastHb - timeout}ms`,
        );
      }
    }
  }

  return {
    healthy: overdueWatchdogs.length === 0,
    checkedAt: new Date(nowMs).toISOString(),
    activeWatchdogsCount: activeWatchdogs.length,
    staleWatchdogsCount: staleCount,
    terminatedWatchdogsCount: terminatedCount,
    orphanedWatchdogsCount: orphanedCount,
    activeWatchdogs,
    overdueWatchdogs,
    hungAgentIds,
    issues,
  };
}
export function recoverStaleTasks(
  port: TransactionPort,
  options: {
    now?: Date | string | number | undefined;
    timeoutMs?: number | undefined;
    maxRepairRounds?: number | undefined;
    actor?: string | undefined;
  } = {},
): TaskRecoveryResult {
  const nowMs = parseTimestamp(options.now);
  const actor = options.actor ?? "scheduler-watchdog";
  const maxRepairRounds = options.maxRepairRounds ?? 3;
  const recoveredTasks: TaskRecoveryRecord[] = [];
  const details: string[] = [];

  port.transact(
    actor,
    "scheduler-stale-tasks-recovery",
    { timestamp: new Date(nowMs).toISOString() },
    (draft) => {
      const currentState = draft;
      const staleProbe = probeStaleLeases(
        currentState,
        options.timeoutMs !== undefined
          ? { now: nowMs, timeoutMs: options.timeoutMs }
          : { now: nowMs },
      );

      for (const staleInfo of staleProbe.staleLeases) {
        const task = draft.tasks[staleInfo.taskId];
        if (!task) continue;

        if (!Array.isArray(task.history)) {
          task.history = [];
        }
        if (!Array.isArray(task.attempts)) {
          task.attempts = [];
        }

        const fromStatus = task.status;
        const currentRound = typeof task.repair_round === "number" ? task.repair_round : 0;
        const targetStatus: TaskStatus = currentRound < maxRepairRounds ? "retry_ready" : "stale";
        const reason = `Automated recovery: lease expired for agent '${staleInfo.agentId}' (${staleInfo.reason})`;

        transition(task, targetStatus, actor, new Date(nowMs), reason);
        task.replacement_reason = "stale";
        task.replacement_evidence = reason;
        delete task.lease;

        const record: TaskRecoveryRecord = {
          taskId: staleInfo.taskId,
          fromStatus,
          toStatus: targetStatus,
          agentId: staleInfo.agentId,
          reason,
          attempt: task.attempts.length,
          recoveredAt: new Date(nowMs).toISOString(),
        };
        recoveredTasks.push(record);
        details.push(
          `Task '${staleInfo.taskId}' transitioned from ${fromStatus} -> ${targetStatus}.`,
        );
      }
    },
  );

  return {
    recoveredCount: recoveredTasks.length,
    recoveredTasks,
    healthy: recoveredTasks.length === 0,
    details,
  };
}
