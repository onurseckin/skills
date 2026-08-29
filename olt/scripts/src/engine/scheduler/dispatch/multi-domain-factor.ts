import { HarnessError } from "../../../core/errors/index.ts";
import { dependencyMap } from "../../../graph/dependency-map.ts";
import { isRecord } from "../../../requirements/predicates.ts";
import { type ScheduledTask } from "../conflict/rank.ts";
import { computeWorkSpanMetrics } from "../topology/dynamic-metrics.ts";
import { normalizeTask } from "./multi-domain-types.ts";

export function resolveParallelismFactor(state: unknown, explicitFactor?: number): number {
  if (explicitFactor !== undefined) {
    if (typeof explicitFactor !== "number" || Number.isNaN(explicitFactor) || explicitFactor < 0) {
      throw new HarnessError("INVALID_ARGUMENT", "parallelismFactor must be a non-negative number");
    }
    return Number(explicitFactor.toFixed(2));
  }

  if (isRecord(state)) {
    if (isRecord(state.graph) && isRecord(state.tasks)) {
      try {
        const dependencies = dependencyMap(state.graph);
        const tasks = new Map<string, ScheduledTask>();
        for (const [id, value] of Object.entries(state.tasks)) {
          const norm = normalizeTask(id, value);
          if (norm) tasks.set(id, norm);
        }
        if (tasks.size > 0) {
          const metrics = computeWorkSpanMetrics(dependencies, tasks);
          return metrics.parallelismFactor;
        }
      } catch {
        // Fallback to state metrics
      }
    }

    if (
      typeof state.workParallelismRatio === "number" &&
      !Number.isNaN(state.workParallelismRatio)
    ) {
      return Number(state.workParallelismRatio.toFixed(2));
    }
    if (typeof state.parallelismFactor === "number" && !Number.isNaN(state.parallelismFactor)) {
      return Number(state.parallelismFactor.toFixed(2));
    }
  }

  return 1.0;
}
