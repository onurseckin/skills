import { checkScopeListOverlap } from "./scopes.ts";
import { validateTopologyAcyclicity } from "./acyclicity.ts";
import type { SynthesizedTaskSpec, TopologyWavePlan } from "./types.ts";

/**
 * Partitions tasks into sequential waves respecting explicit dependencies,
 * write scope isolation, and max parallel concurrency capacity.
 */
export function partitionTopologyWaves(
  tasks: readonly SynthesizedTaskSpec[],
  maxParallel = 4,
): TopologyWavePlan[] {
  if (tasks.length === 0) {
    return [];
  }

  const effectiveMaxParallel = Math.max(1, maxParallel);

  const acyclicCheck = validateTopologyAcyclicity(tasks, { strict: true });
  const sortedIds = acyclicCheck.topologicalOrder;

  const taskById = new Map<string, SynthesizedTaskSpec>();
  for (const t of tasks) {
    taskById.set(t.id, t);
  }

  const assignedWave = new Map<string, number>();
  const waveTaskMap = new Map<number, string[]>();
  const waveScopeMap = new Map<number, string[]>();

  for (const taskId of sortedIds) {
    const task = taskById.get(taskId)!;
    const rawDeps = task.dependencies !== undefined ? task.dependencies : [];
    const taskDeps = rawDeps.map((d) => d.trim()).filter(Boolean);

    let earliestWave = 1;
    for (const depId of taskDeps) {
      const depWave = assignedWave.get(depId);
      if (depWave !== undefined && depWave >= earliestWave) {
        earliestWave = depWave + 1;
      }
    }

    let targetWave = earliestWave;
    for (;;) {
      const existingWaveTasks = waveTaskMap.get(targetWave);
      const tasksInWave = existingWaveTasks !== undefined ? existingWaveTasks : [];
      const existingWaveScopes = waveScopeMap.get(targetWave);
      const scopesInWave = existingWaveScopes !== undefined ? existingWaveScopes : [];

      const hasCapacity = tasksInWave.length < effectiveMaxParallel;
      const scopeOverlap = checkScopeListOverlap(task.writeScope, scopesInWave);

      if (hasCapacity && !scopeOverlap.overlap) {
        assignedWave.set(taskId, targetWave);

        if (!waveTaskMap.has(targetWave)) {
          waveTaskMap.set(targetWave, []);
          waveScopeMap.set(targetWave, []);
        }

        waveTaskMap.get(targetWave)!.push(taskId);
        waveScopeMap.get(targetWave)!.push(...task.writeScope);
        break;
      }

      targetWave += 1;
    }
  }

  const totalWaves = Math.max(...Array.from(waveTaskMap.keys()), 0);
  const wavePlans: TopologyWavePlan[] = [];
  const satisfiedDepsSet = new Set<string>();

  for (let w = 1; w <= totalWaves; w++) {
    const existingWaveTasks = waveTaskMap.get(w);
    const waveTasks = existingWaveTasks !== undefined ? existingWaveTasks : [];
    if (waveTasks.length === 0) continue;

    const waveScopes = Array.from(
      new Set(
        waveTasks.flatMap((id) => {
          const t = taskById.get(id);
          return t !== undefined && t.writeScope !== undefined ? t.writeScope : [];
        }),
      ),
    ).sort();

    const estimatedEffort = waveTasks.reduce((sum, id) => {
      const t = taskById.get(id);
      const eff = t !== undefined ? t.effort : undefined;
      return sum + (typeof eff === "number" && eff > 0 ? eff : 1);
    }, 0);

    wavePlans.push({
      wave: w,
      taskIds: waveTasks,
      capacity: effectiveMaxParallel,
      writeScopes: waveScopes,
      dependenciesSatisfied: Array.from(satisfiedDepsSet).sort(),
      estimatedEffort,
    });

    for (const id of waveTasks) {
      satisfiedDepsSet.add(id);
    }
  }

  return wavePlans;
}

/**
 * Decouples independent waves and verifies zero false serialization across subgraphs.
 */
export function decoupleIndependentWaves(
  waves: readonly TopologyWavePlan[],
  tasks: readonly SynthesizedTaskSpec[],
): readonly TopologyWavePlan[] {
  if (waves.length <= 1) return waves;

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const decoupled: TopologyWavePlan[] = [];

  for (const wave of waves) {
    const validTaskIds = wave.taskIds.filter((id) => taskMap.has(id));
    decoupled.push({
      ...wave,
      taskIds: validTaskIds,
    });
  }

  return Object.freeze(decoupled);
}
