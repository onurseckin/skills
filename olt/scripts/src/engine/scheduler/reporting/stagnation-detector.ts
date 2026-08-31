import { generateStagnationBadge } from "../diagnostics/ascii-badges.ts";
import type {
  SchedulerProgressDiff,
  SchedulerProgressSnapshot,
  StagnationSeverity,
  StagnationWarning,
} from "./types.ts";

export interface StagnationDetectionOptions {
  readonly diff: SchedulerProgressDiff;
  readonly snapshot: SchedulerProgressSnapshot;
  readonly zeroValueStreak?: number | undefined;
  readonly warningThreshold?: number | undefined;
  readonly criticalThreshold?: number | undefined;
}

export function detectStagnation(options: StagnationDetectionOptions): StagnationWarning {
  const warningThreshold = options.warningThreshold ?? 2;
  const criticalThreshold = options.criticalThreshold ?? 4;
  const streak = Math.max(
    options.diff.consecutiveZeroProgressTicks,
    options.zeroValueStreak ?? 0,
  );

  const isAllComplete =
    options.snapshot.totalTasks > 0 &&
    options.snapshot.completedTasks === options.snapshot.totalTasks;

  if (isAllComplete) {
    return {
      level: "none",
      isStagnating: false,
      streak: 0,
      reason: "All planned tasks in DAG have completed successfully.",
      remediation:
        "Execute run:complete or activate Mind Mode A autonomous feature discovery.",
      badge: "[✨ Complete: all tasks done]",
    };
  }

  if (options.snapshot.readyTasks > 0 && options.snapshot.activeAgents.length === 0) {
    const readyIds = options.snapshot.tasks
      .filter((t) => t.status === "ready")
      .map((t) => t.id)
      .slice(0, 3)
      .join(", ");
    return {
      level: streak >= criticalThreshold ? "critical" : "warning",
      isStagnating: true,
      streak: Math.max(streak, 1),
      reason: `${options.snapshot.readyTasks} ready task(s) (${readyIds}) are waiting in queue but 0 active agents are dispatched.`,
      remediation:
        "Dispatch workers with agent:register and claim ready tasks using task:claim.",
      badge: `[🚨 Worker Starvation: ${options.snapshot.readyTasks} ready, 0 agents]`,
    };
  }

  if (options.snapshot.failedTasks > 0 && options.snapshot.leasedTasks === 0) {
    const failedIds = options.snapshot.tasks
      .filter((t) => t.status === "failed" || t.status === "rejected")
      .map((t) => t.id)
      .slice(0, 3)
      .join(", ");
    return {
      level: "critical",
      isStagnating: true,
      streak: Math.max(streak, 1),
      reason: `${options.snapshot.failedTasks} task(s) (${failedIds}) failed and no repairers are currently leased.`,
      remediation:
        "Assign repairer subagents with task:claim --role repairer or run recover.",
      badge: `[🔴 Failed Tasks: ${options.snapshot.failedTasks} blocked]`,
    };
  }

  if (streak >= criticalThreshold) {
    return {
      level: "critical",
      isStagnating: true,
      streak,
      reason: `Scheduler observed 0 state transitions across ${streak} consecutive ticks with ${options.snapshot.totalTasks - options.snapshot.completedTasks} incomplete tasks.`,
      remediation:
        "Audit lease responsiveness with task:heartbeat, reclaim stale leases, or inspect agent logs.",
      badge: generateStagnationBadge(streak, true),
    };
  }

  if (streak >= warningThreshold) {
    return {
      level: "warning",
      isStagnating: true,
      streak,
      reason: `Scheduler progress idling for ${streak} consecutive ticks without task state transitions.`,
      remediation:
        "Monitor active worker progress or claim next wave tasks when unblocked.",
      badge: generateStagnationBadge(streak, true),
    };
  }

  if (streak > 0) {
    return {
      level: "info",
      isStagnating: false,
      streak,
      reason: `Temporary pause across ${streak} tick(s); tasks in progress.`,
      remediation: "Continue autonomous polling cadence.",
      badge: generateStagnationBadge(streak, false),
    };
  }

  const level: StagnationSeverity = "none";
  return {
    level,
    isStagnating: false,
    streak: 0,
    reason: "Active task progress flowing normally.",
    remediation: "Continue autonomous execution cadence.",
    badge: generateStagnationBadge(0, false),
  };
}
