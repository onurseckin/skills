import { createHash } from "node:crypto";
import type { BrentConcurrencyPlan, BrentPartition } from "../mind/preplanning/types.ts";

export interface BrentDecompositionOptions {
  readonly workUnits: number;
  readonly spanLength?: number | undefined;
  readonly minParallelism?: number | undefined;
  readonly maxParallelism?: number | undefined;
  readonly scopeFiles?: readonly string[] | undefined;
  readonly parentTaskId?: string | undefined;
  readonly targetDurationSeconds?: number | undefined;
}

export const DEFAULT_MIN_PARALLELISM = 5;
export const DEFAULT_MAX_PARALLELISM = 15;
export const DEFAULT_TARGET_DURATION_SECONDS = 180; // 3 minutes (within 120s - 240s window)

export function partitionScopeDisjoint(
  scopeFiles: readonly string[],
  parallelism: number,
): readonly (readonly string[])[] {
  if (scopeFiles.length === 0 || parallelism <= 0) {
    return [];
  }

  const numPartitions = Math.min(parallelism, scopeFiles.length);
  const partitions: string[][] = Array.from({ length: numPartitions }, () => []);

  // Round-robin distribution to keep partitions balanced
  for (let i = 0; i < scopeFiles.length; i++) {
    const partition = partitions[i % numPartitions];
    const file = scopeFiles[i];
    if (partition !== undefined && file !== undefined) {
      partition.push(file);
    }
  }

  return Object.freeze(partitions.map((p) => Object.freeze(p)));
}

export function calculateBrentDecomposition(
  options: BrentDecompositionOptions,
): BrentConcurrencyPlan {
  const workUnits = Math.max(0, options.workUnits);
  const spanLength = Math.max(1, options.spanLength ?? 1);
  const minP = options.minParallelism ?? DEFAULT_MIN_PARALLELISM;
  const maxP = options.maxParallelism ?? DEFAULT_MAX_PARALLELISM;
  const targetDuration = options.targetDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS;

  // Brent's Theorem: P = ceil(W / S)
  const theoreticalParallelism = Math.ceil(workUnits / spanLength);

  // If workUnits is very small (less than minP), we scale parallelism to workUnits (at least 1 if workUnits > 0)
  const optimalParallelism =
    workUnits === 0
      ? 0
      : workUnits < minP
        ? Math.max(1, Math.min(workUnits, theoreticalParallelism))
        : Math.min(maxP, Math.max(minP, theoreticalParallelism));

  const scopeFiles = options.scopeFiles ?? [];
  const parentId = options.parentTaskId ?? "task";

  let subPartitions: BrentPartition[] = [];

  if (scopeFiles.length > 0) {
    const partitionedFiles = partitionScopeDisjoint(scopeFiles, optimalParallelism);
    subPartitions = partitionedFiles.map((files, index) => {
      const hash = createHash("sha256")
        .update(`${parentId}:${index}:${files.join(",")}`)
        .digest("hex")
        .slice(0, 6);
      return {
        subtask_id: `${parentId}-sublane-${index + 1}-${hash}`,
        assigned_scope: files,
        target_duration_seconds: targetDuration,
      };
    });
  } else if (optimalParallelism > 0) {
    const unitsPerPartition = Math.ceil(workUnits / optimalParallelism);
    subPartitions = Array.from({ length: optimalParallelism }, (_, index) => {
      const startUnit = index * unitsPerPartition + 1;
      const endUnit = Math.min(workUnits, (index + 1) * unitsPerPartition);
      return {
        subtask_id: `${parentId}-sublane-${index + 1}`,
        assigned_scope: Object.freeze([`unit-range-${startUnit}-to-${endUnit}`]),
        target_duration_seconds: targetDuration,
      };
    });
  }

  return {
    active_workers: optimalParallelism,
    remaining_work_units: workUnits,
    span_length: spanLength,
    optimal_parallelism: optimalParallelism,
    estimated_subagent_duration_seconds: targetDuration,
    sub_partitions: Object.freeze(subPartitions),
  };
}

export interface StragglingTask {
  readonly id: string;
  readonly agent_id?: string | undefined;
  readonly scope_files?: readonly string[] | undefined;
  readonly work_units?: number | undefined;
  readonly span_length?: number | undefined;
}

export interface RebalancedTaskPackage {
  readonly original_task_id: string;
  readonly decomposition_plan: BrentConcurrencyPlan;
  readonly rebalanced_at: string;
  readonly spawned_subtasks: readonly {
    readonly subtask_id: string;
    readonly assigned_scope: readonly string[];
    readonly target_duration_seconds: number;
    readonly priority: "HIGH_STRAGGLER_REBALANCE";
  }[];
}

export function rebalanceStragglerTask(
  task: StragglingTask,
  options?:
    | {
        minParallelism?: number | undefined;
        maxParallelism?: number | undefined;
        targetDurationSeconds?: number | undefined;
      }
    | undefined,
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
