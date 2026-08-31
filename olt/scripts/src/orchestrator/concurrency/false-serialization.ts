import { HarnessError } from "../../core/errors/index.ts";
import { checkScopeListOverlap } from "../topology/scopes.ts";
import type { SynthesizedTaskSpec, TopologyWavePlan } from "../topology/types.ts";
import type { FalseSerializationReport, FalseSerializationViolation } from "./types.ts";

/**
 * Detects false serialization where independent tasks with disjoint write scopes
 * and no semantic dependencies were placed in sequential waves despite capacity.
 */
export function detectFalseSerialization(
  tasks: readonly SynthesizedTaskSpec[],
  waves: readonly TopologyWavePlan[],
  maxParallel = 4,
): FalseSerializationReport {
  const violations: FalseSerializationViolation[] = [];
  const diagnostics: string[] = [];
  let checkedPairs = 0;

  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Inspect cross-wave task pairs
  for (let w = 0; w < waves.length - 1; w++) {
    const currentWave = waves[w]!;
    const nextWave = waves[w + 1]!;

    if (currentWave.taskIds.length < maxParallel) {
      for (const nextTaskId of nextWave.taskIds) {
        const nextTask = taskMap.get(nextTaskId);
        if (!nextTask) continue;

        const nextDeps = nextTask.dependencies ?? [];
        const hasDepInCurrentWave = currentWave.taskIds.some((id) => nextDeps.includes(id));

        if (!hasDepInCurrentWave) {
          // Check scope collision with all tasks in current wave
          const currentScopes = currentWave.taskIds.flatMap((id) => {
            const t = taskMap.get(id);
            return t ? t.writeScope : [];
          });

          const overlap = checkScopeListOverlap(nextTask.writeScope, currentScopes);
          checkedPairs += currentWave.taskIds.length;

          if (!overlap.overlap) {
            violations.push({
              taskIdA: currentWave.taskIds[0] ?? "unknown",
              taskIdB: nextTaskId,
              reason: `Task '${nextTaskId}' in wave ${nextWave.wave} has no dependencies on wave ${currentWave.wave}, disjoint write scopes, and wave ${currentWave.wave} had free capacity (${currentWave.taskIds.length}/${maxParallel}).`,
              remedy: `Decouple task '${nextTaskId}' and move into wave ${currentWave.wave} for concurrent execution.`,
            });
          }
        }
      }
    }
  }

  diagnostics.push(
    `Total Tasks: ${tasks.length}`,
    `Total Waves: ${waves.length}`,
    `Checked Pairs: ${checkedPairs}`,
    `False Serialization Violations: ${violations.length}`,
  );

  return {
    detected: violations.length > 0,
    violations: Object.freeze(violations),
    checkedTaskPairsCount: checkedPairs,
    diagnostics: Object.freeze(diagnostics),
  };
}

/**
 * Asserts zero false serialization in a synthesized topology.
 */
export function assertNoFalseSerialization(
  tasks: readonly SynthesizedTaskSpec[],
  waves: readonly TopologyWavePlan[],
  options?: { readonly maxParallel?: number | undefined; readonly strict?: boolean | undefined },
): FalseSerializationReport {
  const maxParallel = options?.maxParallel ?? 4;
  const strict = options?.strict !== false;
  const report = detectFalseSerialization(tasks, waves, maxParallel);

  if (strict && report.detected) {
    const details = report.violations.map((v) => v.reason).join("; ");
    throw new HarnessError(
      "INTEGRITY",
      `False serialization detected in wave topology: ${details}`,
    );
  }

  return report;
}
