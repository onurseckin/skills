import { estimated, evidenced, type Evidenced } from "../contracts/evidence.ts";
import { readTopology, topologyWavesByTask } from "../contracts/topology.ts";
import type { TaskRecord } from "../workflow/types.ts";

export type WaveSource = "recorded" | "derived";

export interface StepAssignments {
  taskSteps: Map<string, number>;
  taskWaves: Map<string, number>;
  maxStep: number;
  criticStep: number;
  terminalStep: number;
  /**
   * "recorded" when every wave came from `state.topology`. The fallback is flagged as an estimate
   * because it partitions on dependencies alone and cannot see the write-scope conflicts the
   * scheduler serializes on, so its waves are wider than the run could ever have executed.
   */
  waveSource: Evidenced<WaveSource>;
  topologyRevision: number | null;
}

function stepsFromWaves(
  taskWaves: Map<string, number>,
  waveCount: number,
  waveSource: Evidenced<WaveSource>,
  topologyRevision: number | null,
): StepAssignments {
  const taskSteps = new Map([...taskWaves].map(([id, wave]) => [id, wave * 2]));
  const criticStep = waveCount * 2 + 2;
  return {
    taskSteps,
    taskWaves,
    maxStep: criticStep + 1,
    criticStep,
    terminalStep: criticStep + 1,
    waveSource,
    topologyRevision,
  };
}

function deriveWaves(tasks: readonly TaskRecord[]): { waves: Map<string, number>; count: number } {
  const taskWaves = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const t of tasks) {
    inDegree.set(t.id, t.dependencies.length);
    for (const dep of t.dependencies) {
      const list = adj.get(dep) ?? [];
      list.push(t.id);
      adj.set(dep, list);
    }
  }

  let currentWave = tasks.filter((t) => t.dependencies.length === 0).map((t) => t.id);
  // If tasks are non-empty but all have dependencies (cycle or unresolved), pick all tasks
  if (currentWave.length === 0 && tasks.length > 0) {
    currentWave = tasks.map((t) => t.id);
  }

  let waveNum = 1;
  const processed = new Set<string>();

  while (currentWave.length > 0) {
    for (const taskId of currentWave) {
      taskWaves.set(taskId, waveNum);
      processed.add(taskId);
    }

    const nextWave: string[] = [];
    for (const taskId of currentWave) {
      for (const neighbor of adj.get(taskId) ?? []) {
        const remaining = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, remaining);
        if (remaining <= 0 && !processed.has(neighbor)) {
          nextWave.push(neighbor);
        }
      }
    }

    // Handle any unreachable / orphan tasks not yet processed
    if (nextWave.length === 0 && processed.size < tasks.length) {
      nextWave.push(...tasks.filter((t) => !processed.has(t.id)).map((t) => t.id));
    }

    currentWave = nextWave;
    if (currentWave.length > 0) {
      waveNum++;
    }
  }

  return { waves: taskWaves, count: waveNum };
}

/**
 * Computes deterministic execution steps from the wave partitioning.
 * Step 1: Prompt & Plan
 * Wave W Tasks: Step 2*W
 * Wave W Gates: Step 2*W + 1
 * Critic: Step 2*W_max + 2
 * Terminal: Step 2*W_max + 3
 *
 * `state` is the run state the topology was recorded on. Waves come from `state.topology` when it
 * covers every task; anything less falls back to the dependency-only partition, and the result says
 * which of the two the caller got.
 */
export function computeExecutionSteps(tasks: TaskRecord[], state?: unknown): StepAssignments {
  const topology = state === undefined ? null : readTopology(state);
  if (topology !== null) {
    const recorded = topologyWavesByTask(topology);
    const covered = tasks.every((task) => recorded.has(task.id));
    if (covered) {
      const taskWaves = new Map(tasks.map((task) => [task.id, recorded.get(task.id)!]));
      const waveCount = Math.max(0, ...taskWaves.values()) || 1;
      return stepsFromWaves(
        taskWaves,
        waveCount,
        evidenced<WaveSource>("recorded", "derived"),
        topology.revision,
      );
    }
  }
  const { waves, count } = deriveWaves(tasks);
  return stepsFromWaves(waves, count, estimated<WaveSource>("derived"), null);
}
