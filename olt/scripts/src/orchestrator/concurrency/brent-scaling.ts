import { createHash } from "node:crypto";
import { partitionScopeDisjoint } from "./scope-partition.ts";
import type { BrentConcurrencyPlan, BrentDecompositionOptions, BrentPartition } from "./types.ts";

export const DEFAULT_MIN_PARALLELISM = 5;
export const DEFAULT_MAX_PARALLELISM = 15;
export const DEFAULT_TARGET_DURATION_SECONDS = 180; // 3 minutes (within 120s - 240s window)

/**
 * Computes optimal Brent dynamic concurrency: P = ceil(W / S)
 * bounded by [minParallelism, maxParallelism].
 */
export function calculateBrentConcurrency(
  workUnits: number,
  spanLength = 1,
  minParallelism = DEFAULT_MIN_PARALLELISM,
  maxParallelism = DEFAULT_MAX_PARALLELISM,
): number {
  const w = Math.max(0, workUnits);
  const s = Math.max(1, spanLength);

  if (w === 0) return 0;

  const theoreticalP = Math.ceil(w / s);

  if (w < minParallelism) {
    return Math.max(1, Math.min(w, theoreticalP));
  }

  return Math.min(maxParallelism, Math.max(minParallelism, theoreticalP));
}

/**
 * Calculates dynamic wave capacity based on total work units and critical span.
 */
export function calculateDynamicWaveCapacity(
  tasks: readonly { readonly effort?: number | undefined }[],
  criticalDepth: number,
  options?: {
    readonly minParallelism?: number | undefined;
    readonly maxParallelism?: number | undefined;
  },
): number {
  const totalEffort = tasks.reduce((sum, t) => {
    const eff = typeof t.effort === "number" && t.effort > 0 ? t.effort : 1;
    return sum + eff;
  }, 0);

  const span = Math.max(1, criticalDepth);
  const minP = options?.minParallelism ?? DEFAULT_MIN_PARALLELISM;
  const maxP = options?.maxParallelism ?? DEFAULT_MAX_PARALLELISM;

  return calculateBrentConcurrency(totalEffort, span, minP, maxP);
}

/**
 * Decomposes work into sub-partitions using Brent's Work/Span dynamic concurrency.
 */
export function calculateBrentDecomposition(
  options: BrentDecompositionOptions,
): BrentConcurrencyPlan {
  const workUnits = Math.max(0, options.workUnits);
  const spanLength = Math.max(1, options.spanLength ?? 1);
  const minP = options.minParallelism ?? DEFAULT_MIN_PARALLELISM;
  const maxP = options.maxParallelism ?? DEFAULT_MAX_PARALLELISM;
  const targetDuration = options.targetDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS;

  const optimalParallelism = calculateBrentConcurrency(workUnits, spanLength, minP, maxP);

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
      const hash = createHash("sha256")
        .update(`${parentId}:${index}:${startUnit}-${endUnit}`)
        .digest("hex")
        .slice(0, 6);
      return {
        subtask_id: `${parentId}-sublane-${index + 1}-${hash}`,
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
