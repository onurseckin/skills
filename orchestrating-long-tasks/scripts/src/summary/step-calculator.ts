import type { TaskRecord } from "../workflow/types.ts";

export interface StepAssignments {
  taskSteps: Map<string, number>;
  taskWaves: Map<string, number>;
  maxStep: number;
  criticStep: number;
  terminalStep: number;
}

/**
 * Computes deterministic execution steps and topological wave partitioning.
 * Step 1: Prompt & Plan
 * Wave W Tasks: Step 2*W
 * Wave W Gates: Step 2*W + 1
 * Critic: Step 2*W_max + 2
 * Terminal: Step 2*W_max + 3
 */
export function computeExecutionSteps(tasks: TaskRecord[]): StepAssignments {
  const taskSteps = new Map<string, number>();
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
    const taskStep = waveNum * 2;
    for (const taskId of currentWave) {
      taskSteps.set(taskId, taskStep);
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
      const remainingTasks = tasks.filter((t) => !processed.has(t.id)).map((t) => t.id);
      nextWave.push(...remainingTasks);
    }

    currentWave = nextWave;
    if (currentWave.length > 0) {
      waveNum++;
    }
  }

  const maxTaskStep = waveNum * 2;
  const maxGateStep = maxTaskStep + 1;
  const criticStep = maxGateStep + 1;
  const terminalStep = criticStep + 1;

  return {
    taskSteps,
    taskWaves,
    maxStep: terminalStep,
    criticStep,
    terminalStep,
  };
}
