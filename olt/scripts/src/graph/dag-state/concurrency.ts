import type { ParallelLaneAssignment } from "../parallel-decoupler.ts";
import type { ConcurrencyWave } from "../scope-analyzer.ts";
import type { ConcurrencyMetricsResult } from "./types.ts";

export function computeConcurrencyMetrics(
  waves: readonly ConcurrencyWave[],
  lanes: readonly ParallelLaneAssignment[] = [],
): ConcurrencyMetricsResult {
  const totalWaves = waves.length;
  let totalTasks = 0;
  let maxParallelism = 0;

  for (const wave of waves) {
    const count = wave.tasks.length;
    totalTasks += count;
    if (count > maxParallelism) {
      maxParallelism = count;
    }
  }

  const averageWaveConcurrency = totalWaves > 0 ? Number((totalTasks / totalWaves).toFixed(2)) : 0;
  const laneUtilization =
    lanes.length > 0
      ? Number((lanes.filter((l) => l.taskId.length > 0).length / lanes.length).toFixed(2))
      : 1;
  const theoreticalSpeedup = totalWaves > 0 ? Number((totalTasks / totalWaves).toFixed(2)) : 1;

  return {
    maxParallelism,
    totalTasks,
    totalWaves,
    laneUtilization,
    averageWaveConcurrency,
    theoreticalSpeedup,
  };
}
