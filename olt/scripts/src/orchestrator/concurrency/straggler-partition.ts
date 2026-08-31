import { calculateBrentDecomposition } from "./brent-scaling.ts";
import type {
  RebalancedTaskPackage,
  RebalanceStragglerOptions,
  StragglerPartitionReport,
  StragglingTask,
} from "./types.ts";

export const STRAGGLER_SLA_SECONDS = 300; // 5-minute straggler SLA threshold
export const STRAGGLER_SLA_MS = STRAGGLER_SLA_SECONDS * 1000;

/**
 * Checks whether a task has breached the 5-minute (300s) SLA threshold.
 */
export function isTaskStraggling(
  task: StragglingTask,
  elapsedSeconds?: number,
  slaThresholdSeconds = STRAGGLER_SLA_SECONDS,
): boolean {
  const elapsed =
    typeof elapsedSeconds === "number"
      ? elapsedSeconds
      : typeof task.elapsed_seconds === "number"
        ? task.elapsed_seconds
        : typeof task.started_at === "number"
          ? (Date.now() - task.started_at) / 1000
          : typeof task.started_at === "string"
            ? (Date.now() - new Date(task.started_at).getTime()) / 1000
            : 0;

  return elapsed >= slaThresholdSeconds;
}

/**
 * Rebalances an individual straggling task by applying Brent decomposition.
 */
export function rebalanceStragglerTask(
  task: StragglingTask,
  options?: RebalanceStragglerOptions | undefined,
): RebalancedTaskPackage {
  const scopeFiles = task.scope_files ?? [];
  const workUnits = task.work_units ?? Math.max(1, scopeFiles.length);

  const plan = calculateBrentDecomposition({
    workUnits,
    spanLength: task.span_length ?? 1,
    minParallelism: options?.minParallelism,
    maxParallelism: options?.maxParallelism,
    scopeFiles,
    parentTaskId: task.id,
    targetDurationSeconds: options?.targetDurationSeconds,
  });

  const spawnedSubtasks = plan.sub_partitions.map((partition) => ({
    subtask_id: partition.subtask_id,
    assigned_scope: partition.assigned_scope,
    target_duration_seconds: partition.target_duration_seconds,
    priority: "HIGH_STRAGGLER_REBALANCE" as const,
  }));

  return {
    original_task_id: task.id,
    decomposition_plan: plan,
    rebalanced_at: new Date().toISOString(),
    spawned_subtasks: Object.freeze(spawnedSubtasks),
  };
}

export function decomposeStragglingTask(
  task: StragglingTask,
  options?: RebalanceStragglerOptions | undefined,
): RebalancedTaskPackage {
  return rebalanceStragglerTask(task, options);
}

/**
 * Partitions a pool of tasks into on-schedule vs 5-minute stragglers,
 * decomposing and isolating stragglers into an async lane to prevent wave blockage.
 */
export function partitionStragglers(
  tasks: readonly StragglingTask[],
  options?: RebalanceStragglerOptions | undefined,
): StragglerPartitionReport {
  const slaThreshold = options?.slaThresholdSeconds ?? STRAGGLER_SLA_SECONDS;
  const onSchedule: string[] = [];
  const stragglers: string[] = [];
  const rebalancedPackages: RebalancedTaskPackage[] = [];

  for (const task of tasks) {
    if (isTaskStraggling(task, undefined, slaThreshold)) {
      stragglers.push(task.id);
      rebalancedPackages.push(rebalanceStragglerTask(task, options));
    } else {
      onSchedule.push(task.id);
    }
  }

  return {
    onScheduleTasks: Object.freeze(onSchedule),
    stragglerTasks: Object.freeze(stragglers),
    partitionedAt: new Date().toISOString(),
    slaThresholdSeconds: slaThreshold,
    rebalancedPackages: Object.freeze(rebalancedPackages),
  };
}
