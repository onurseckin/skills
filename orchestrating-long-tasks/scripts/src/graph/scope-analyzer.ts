import { posix } from "node:path";

export interface TaskScopeInput {
  taskId: string;
  writeScope: readonly string[];
  dependencies?: readonly string[] | undefined;
}

export interface ScopeCollision {
  taskA: string;
  taskB: string;
  conflictingPath: string;
  relation: "exact_match" | "parent_child";
}

export interface SerializationWarning {
  blockedTask: string;
  dependencyTask: string;
  message: string;
}

export interface ConcurrencyWave {
  waveIndex: number;
  tasks: string[];
}

export interface ScopeAnalysisResult {
  collisions: ScopeCollision[];
  serializationWarnings: SerializationWarning[];
  concurrencyWaves: ConcurrencyWave[];
}

export function normalizeScopePath(path: string): string {
  let normalized = posix.normalize(path.trim().replace(/\\/g, "/"));
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  while (normalized.endsWith("/") && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function checkScopeOverlap(
  scopesA: readonly string[],
  scopesB: readonly string[],
): { hasOverlap: boolean; conflictingPath: string; relation: "exact_match" | "parent_child" | "none" } {
  for (const a of scopesA) {
    for (const b of scopesB) {
      if (a === b) {
        return { hasOverlap: true, conflictingPath: a, relation: "exact_match" };
      }
      if (a.startsWith(`${b}/`)) {
        return { hasOverlap: true, conflictingPath: a, relation: "parent_child" };
      }
      if (b.startsWith(`${a}/`)) {
        return { hasOverlap: true, conflictingPath: b, relation: "parent_child" };
      }
    }
  }
  return { hasOverlap: false, conflictingPath: "", relation: "none" };
}

function hasTransitiveDependency(
  fromId: string,
  toId: string,
  depsMap: ReadonlyMap<string, ReadonlySet<string>>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(fromId)) return false;
  visited.add(fromId);
  const deps = depsMap.get(fromId);
  if (!deps) return false;
  if (deps.has(toId)) return true;
  for (const dep of deps) {
    if (hasTransitiveDependency(dep, toId, depsMap, visited)) return true;
  }
  return false;
}

export function computeConcurrencyWaves(
  tasks: readonly TaskScopeInput[],
  depsMap: ReadonlyMap<string, ReadonlySet<string>>,
): ConcurrencyWave[] {
  const waves: ConcurrencyWave[] = [];
  const assigned = new Set<string>();
  const allTaskIds = new Set(tasks.map((t) => t.taskId));

  let currentWave = 0;
  while (assigned.size < tasks.length) {
    const waveTasks: string[] = [];
    for (const task of tasks) {
      if (assigned.has(task.taskId)) continue;
      const taskDeps = depsMap.get(task.taskId) ?? new Set();
      const validDeps = [...taskDeps].filter((d) => allTaskIds.has(d));
      const allSatisfied = validDeps.every((dep) => assigned.has(dep));
      if (allSatisfied) {
        waveTasks.push(task.taskId);
      }
    }
    if (waveTasks.length === 0) {
      const remaining = tasks.filter((t) => !assigned.has(t.taskId)).map((t) => t.taskId);
      waves.push({ waveIndex: currentWave, tasks: remaining });
      break;
    }
    for (const id of waveTasks) assigned.add(id);
    waves.push({ waveIndex: currentWave, tasks: waveTasks });
    currentWave++;
  }
  return waves;
}

export function analyzeScopeIndependence(tasks: readonly TaskScopeInput[]): ScopeAnalysisResult {
  const normalizedTasks = tasks.map((t) => ({
    taskId: t.taskId,
    writeScope: t.writeScope.map(normalizeScopePath),
    dependencies: (t.dependencies ?? []).filter((d) => Boolean(d.trim())),
  }));

  const depsMap = new Map<string, Set<string>>();
  for (const task of normalizedTasks) {
    depsMap.set(task.taskId, new Set(task.dependencies));
  }

  const collisions: ScopeCollision[] = [];
  for (let i = 0; i < normalizedTasks.length; i++) {
    for (let j = i + 1; j < normalizedTasks.length; j++) {
      const taskA = normalizedTasks[i]!;
      const taskB = normalizedTasks[j]!;

      const aDependsOnB = hasTransitiveDependency(taskA.taskId, taskB.taskId, depsMap);
      const bDependsOnA = hasTransitiveDependency(taskB.taskId, taskA.taskId, depsMap);

      if (!aDependsOnB && !bDependsOnA) {
        const overlap = checkScopeOverlap(taskA.writeScope, taskB.writeScope);
        if (overlap.hasOverlap) {
          collisions.push({
            taskA: taskA.taskId,
            taskB: taskB.taskId,
            conflictingPath: overlap.conflictingPath,
            relation: overlap.relation as "exact_match" | "parent_child",
          });
        }
      }
    }
  }

  const serializationWarnings: SerializationWarning[] = [];
  for (const task of normalizedTasks) {
    for (const depId of task.dependencies) {
      const depTask = normalizedTasks.find((t) => t.taskId === depId);
      if (depTask) {
        const overlap = checkScopeOverlap(task.writeScope, depTask.writeScope);
        if (!overlap.hasOverlap) {
          serializationWarnings.push({
            blockedTask: task.taskId,
            dependencyTask: depTask.taskId,
            message: `Unnecessary sequential dependency: write scopes (${task.writeScope.join(", ")} vs ${depTask.writeScope.join(", ")}) are disjoint.`,
          });
        }
      }
    }
  }

  const concurrencyWaves = computeConcurrencyWaves(normalizedTasks, depsMap);
  return { collisions, serializationWarnings, concurrencyWaves };
}
