import { detectScopeOverlap } from "./collisions.ts";
import { updateCognitiveMemory } from "./memory.ts";
import type { RebalancedTaskPlanResult, SmartTaskPlan, SmartWavePlanResult } from "./models.ts";
import type { MacroMetrics, CognitiveMemoryState } from "./types.ts";
import { planWaveExecution } from "./waves.ts";
import { computeMacroMetrics } from "./metrics.ts";

export function rebalanceTasksWithBrentLimits(
  tasks: readonly SmartTaskPlan[],
  options: {
    readonly maxLanes?: number | undefined;
    readonly preserveJustified?: boolean | undefined;
    readonly autoUpdateMemory?: boolean | undefined;
    readonly cognitiveMemoryPath?: string | undefined;
  } = {},
): RebalancedTaskPlanResult {
  const maxLanes = options.maxLanes ?? 40;
  const preserveJustified = options.preserveJustified ?? true;

  if (tasks.length === 0) {
    const emptyMetrics: MacroMetrics = { work: 0, span: 0, parallelism: 0, efficiency: 0 };
    if (options.autoUpdateMemory) {
      try {
        updateCognitiveMemory(
          (curr) => ({ ...curr, macro_metrics: emptyMetrics }),
          options.cognitiveMemoryPath,
        );
      } catch {}
    }
    return {
      total_waves: 0,
      total_tasks: 0,
      waves: [],
      macro_metrics: emptyMetrics,
      optimal_lanes: 1,
      decoupled_edges_count: 0,
      warnings: [],
    };
  }

  const taskMap = new Map<string, SmartTaskPlan>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const warnings: string[] = [];
  let decoupledCount = 0;
  const prunedTasks: SmartTaskPlan[] = [];

  for (const task of tasks) {
    const prunedDeps: string[] = [];
    for (const depId of task.dependencies) {
      const depTask = taskMap.get(depId);
      if (!depTask) {
        prunedDeps.push(depId);
        continue;
      }

      const overlap = detectScopeOverlap(task.write_scope, depTask.write_scope);
      const isJustified =
        task.rationale.toLowerCase().includes("dataflow") ||
        task.rationale.toLowerCase().includes("artifact") ||
        (task.metadata !== undefined && typeof task.metadata["justification"] === "string");

      if (overlap.length === 0) {
        if (!isJustified || !preserveJustified) {
          warnings.push(
            `Decoupled artificial dependency: ${task.id} -> ${depId} (disjoint write scopes: [${task.write_scope.join(", ")}] vs [${depTask.write_scope.join(", ")}])`,
          );
          decoupledCount++;
        } else {
          prunedDeps.push(depId);
        }
      } else {
        prunedDeps.push(depId);
      }
    }

    prunedTasks.push({
      ...task,
      dependencies: prunedDeps,
    });
  }

  const wavePlan = planWaveExecution(prunedTasks);
  const macroMetrics = computeMacroMetrics(prunedTasks);
  const parallelism = macroMetrics.parallelism > 0 ? macroMetrics.parallelism : 1;
  const optimalLanes = Math.max(1, Math.min(maxLanes, Math.ceil(parallelism)));

  if (options.autoUpdateMemory) {
    try {
      updateCognitiveMemory(
        (curr) => ({
          ...curr,
          macro_metrics: macroMetrics,
        }),
        options.cognitiveMemoryPath,
      );
    } catch {}
  }

  return {
    total_waves: wavePlan.total_waves,
    total_tasks: wavePlan.total_tasks,
    waves: wavePlan.waves,
    macro_metrics: macroMetrics,
    optimal_lanes: optimalLanes,
    hierarchy_scaling: wavePlan.hierarchy_scaling,
    fast_path_compaction: wavePlan.fast_path_compaction,
    multi_coordinator_partitions: wavePlan.multi_coordinator_partitions,
    decoupled_edges_count: decoupledCount,
    warnings,
  };
}
import { readTaskQueue } from "../../../../task/queue/index.ts";
import type { TaskQueueItem } from "../../../../task/queue/index.ts";

export function integrateMacroMetricsIntoMemory(
  tasksOrQueue?: readonly (SmartTaskPlan | TaskQueueItem)[] | undefined,
  options: {
    readonly cognitiveMemoryPath?: string | undefined;
    readonly queuePath?: string | undefined;
    readonly maxLanes?: number | undefined;
  } = {},
): CognitiveMemoryState {
  let targetTasks: readonly (SmartTaskPlan | TaskQueueItem)[];
  if (tasksOrQueue !== undefined && tasksOrQueue.length > 0) {
    targetTasks = tasksOrQueue;
  } else {
    targetTasks = readTaskQueue(options.queuePath);
  }

  const metrics = computeMacroMetrics(targetTasks, options.maxLanes ?? 40);

  return updateCognitiveMemory(
    (curr) => ({
      ...curr,
      macro_metrics: metrics,
    }),
    options.cognitiveMemoryPath,
  );
}

export function rebalanceTaskQueueWithBrentLimits(
  options: {
    readonly queuePath?: string | undefined;
    readonly cognitiveMemoryPath?: string | undefined;
    readonly maxLanes?: number | undefined;
  } = {},
): {
  readonly updated_tasks: readonly TaskQueueItem[];
  readonly macro_metrics: MacroMetrics;
  readonly optimal_lanes: number;
} {
  const queue = readTaskQueue(options.queuePath);
  const metrics = computeMacroMetrics(queue, options.maxLanes ?? 40);
  const optimalLanes = Math.max(
    1,
    Math.min(options.maxLanes ?? 40, Math.ceil(metrics.parallelism > 0 ? metrics.parallelism : 1)),
  );

  integrateMacroMetricsIntoMemory(queue, {
    cognitiveMemoryPath: options.cognitiveMemoryPath,
    queuePath: options.queuePath,
    maxLanes: options.maxLanes,
  });

  return {
    updated_tasks: queue,
    macro_metrics: metrics,
    optimal_lanes: optimalLanes,
  };
}
