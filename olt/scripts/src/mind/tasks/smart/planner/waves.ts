import { HarnessError } from "../../../../core/errors/index.ts";
import {
  evaluateHierarchyScaling,
  partitionWaveCoordinators,
} from "../../../../graph/parallel-decoupler.ts";
import { pathsOverlap } from "./collisions.ts";
import type { SmartTaskPlan, SmartWavePlanResult, WaveGroup } from "./models.ts";
import type {
  HierarchyScalingResult,
  MultiCoordinatorPartitionOptions,
  MultiCoordinatorWavePartitionResult,
  MacroMetrics,
} from "./types.ts";
import { computeMacroMetrics } from "./metrics.ts";

export function planWaveExecution(tasks: readonly SmartTaskPlan[]): SmartWavePlanResult {
  if (tasks.length === 0) {
    return {
      total_waves: 0,
      total_tasks: 0,
      waves: [],
      macro_metrics: {
        work: 0,
        span: 0,
        parallelism: 0,
        efficiency: 0,
      },
      optimal_lanes: 1,
    };
  }

  const taskMap = new Map<string, SmartTaskPlan>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const depthMap = new Map<string, number>();

  function getDepth(taskId: string, visiting: Set<string>): number {
    if (depthMap.has(taskId)) {
      return depthMap.get(taskId)!;
    }
    if (visiting.has(taskId)) {
      throw new HarnessError(
        "INTEGRITY",
        `Circular dependency detected involving task '${taskId}'`,
      );
    }

    visiting.add(taskId);
    const task = taskMap.get(taskId);
    let maxDepDepth = 0;
    if (task) {
      for (const depId of task.dependencies) {
        if (taskMap.has(depId)) {
          const d = getDepth(depId, new Set(visiting));
          if (d + 1 > maxDepDepth) {
            maxDepDepth = d + 1;
          }
        }
      }
    }

    visiting.delete(taskId);
    const depth = maxDepDepth + 1;
    depthMap.set(taskId, depth);
    return depth;
  }

  for (const task of tasks) {
    getDepth(task.id, new Set());
  }

  const depthWaveMap = new Map<number, SmartTaskPlan[]>();
  for (const task of tasks) {
    const depth = depthMap.get(task.id) ?? 1;
    const list = depthWaveMap.get(depth) ?? [];
    list.push(task);
    depthWaveMap.set(depth, list);
  }

  const sortedDepths = [...depthWaveMap.keys()].sort((a, b) => a - b);
  const finalWaves: WaveGroup[] = [];
  let waveIndex = 1;

  for (const depth of sortedDepths) {
    const depthTasks = depthWaveMap.get(depth)!;
    const subWaves: SmartTaskPlan[][] = [];

    for (const task of depthTasks) {
      let placed = false;
      for (const bucket of subWaves) {
        const hasCollision = bucket.some((existing) =>
          existing.write_scope.some((s) => task.write_scope.some((ts) => pathsOverlap(s, ts))),
        );
        if (!hasCollision) {
          bucket.push(task);
          placed = true;
          break;
        }
      }
      if (!placed) {
        subWaves.push([task]);
      }
    }

    for (const bucket of subWaves) {
      const coordPartitions = partitionWaveCoordinators(bucket, { waveIndex });
      finalWaves.push({
        wave_number: waveIndex++,
        task_ids: bucket.map((t) => t.id),
        tasks: bucket,
        coordinator_partitions: coordPartitions.partitions,
      });
    }
  }

  const macroMetrics = computeMacroMetrics(tasks);
  const optimalLanes = Math.max(
    1,
    Math.min(40, Math.ceil(macroMetrics.parallelism > 0 ? macroMetrics.parallelism : 1)),
  );

  const hierarchyScaling = evaluateHierarchyScaling({
    taskCount: tasks.length,
    waveLanes: optimalLanes,
  });

  const multiCoordPartitions = finalWaves.map((w) =>
    partitionWaveCoordinators(w.tasks, { waveIndex: w.wave_number }),
  );

  return {
    total_waves: finalWaves.length,
    total_tasks: tasks.length,
    waves: finalWaves,
    macro_metrics: macroMetrics,
    optimal_lanes: optimalLanes,
    hierarchy_scaling: hierarchyScaling,
    fast_path_compaction: hierarchyScaling.fastPath,
    multi_coordinator_partitions: multiCoordPartitions,
  };
}

export function evaluateSmartHierarchy(
  tasks: readonly SmartTaskPlan[],
  options: {
    readonly waveLanes?: number | undefined;
    readonly multiStack?: boolean | undefined;
    readonly maxLanesPerCoordinator?: number | undefined;
  } = {},
): HierarchyScalingResult {
  return evaluateHierarchyScaling({
    taskCount: tasks.length,
    waveLanes: options.waveLanes,
    multiStack: options.multiStack,
    maxLanesPerCoordinator: options.maxLanesPerCoordinator,
  });
}

export function planMultiCoordinatorWaves(
  wavePlan: SmartWavePlanResult,
  options: MultiCoordinatorPartitionOptions = {},
): readonly MultiCoordinatorWavePartitionResult[] {
  return wavePlan.waves.map((w) =>
    partitionWaveCoordinators(w.tasks, {
      waveIndex: w.wave_number,
      maxLanesPerCoordinator: options.maxLanesPerCoordinator,
      stackPartitioning: options.stackPartitioning,
      domainHints: options.domainHints,
    }),
  );
}

export function compileSmartTasksToWavePlan(tasks: readonly SmartTaskPlan[]): SmartWavePlanResult {
  return planWaveExecution(tasks);
}

export function partitionIntoDisjointWaves(tasks: readonly SmartTaskPlan[]): SmartWavePlanResult {
  return planWaveExecution(tasks);
}
