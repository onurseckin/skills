import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";
import { detectCyclesTarjan } from "./scc.ts";
import type { DagEdge, DagHealOptions, DagHealResult, DagTaskNode } from "./types.ts";

function runWithFlock<T>(lockPath: string | undefined, operation: () => T): T {
  if (!lockPath) return operation();

  const dir = dirname(lockPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let fd: number | undefined;
  let acquired = false;
  try {
    fd = openSync(lockPath, "w+");
    const deadline = Date.now() + 5000;
    while (!acquired && Date.now() < deadline) {
      acquired = tryExclusiveFlock(fd);
      if (!acquired) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    return operation();
  } finally {
    if (fd !== undefined) {
      if (acquired) {
        try {
          releaseFlock(fd);
        } catch {}
      }
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

function computeTopologicalWaves(tasks: readonly DagTaskNode[]): string[][] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const taskMap = new Map<string, DagTaskNode>();

  for (const t of tasks) {
    taskMap.set(t.id, t);
    inDegree.set(t.id, 0);
    dependents.set(t.id, []);
  }

  for (const t of tasks) {
    for (const depId of t.dependencies) {
      if (taskMap.has(depId)) {
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
        dependents.get(depId)?.push(t.id);
      }
    }
  }

  const waves: string[][] = [];
  let ready = Array.from(inDegree.entries())
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort();

  const processed = new Set<string>();

  while (ready.length > 0) {
    waves.push(ready);
    const nextReady: string[] = [];
    for (const id of ready) {
      processed.add(id);
      for (const nextId of dependents.get(id) ?? []) {
        const currentDeg = (inDegree.get(nextId) ?? 1) - 1;
        inDegree.set(nextId, currentDeg);
        if (currentDeg === 0 && !processed.has(nextId)) {
          nextReady.push(nextId);
        }
      }
    }
    ready = nextReady.sort();
  }

  return waves;
}

export function healDag(
  tasks: readonly DagTaskNode[],
  options: DagHealOptions = {},
): DagHealResult {
  return runWithFlock(options.lockPath, () => {
    const actionsTaken: string[] = [];
    const removedEdges: DagEdge[] = [];
    const invertedEdges: DagEdge[] = [];
    const mode = options.mode ?? "prune";

    const taskIds = new Set(tasks.map((t) => t.id));
    let currentTasks: DagTaskNode[] = tasks.map((t) => {
      const cleanDeps = t.dependencies.filter((dep) => {
        if (dep === t.id) {
          actionsTaken.push(`Removed self-dependency on task ${t.id}`);
          removedEdges.push({ from: dep, to: t.id });
          return false;
        }
        if (!taskIds.has(dep)) {
          actionsTaken.push(`Pruned dangling dependency ${dep} from task ${t.id}`);
          removedEdges.push({ from: dep, to: t.id });
          return false;
        }
        return true;
      });
      return { ...t, dependencies: cleanDeps };
    });

    let sccResult = detectCyclesTarjan(currentTasks);
    let iterations = 0;
    while (!sccResult.acyclic && iterations < 10) {
      iterations++;
      for (const arc of sccResult.feedbackArcs) {
        if (mode === "invert" && arc.from !== arc.to) {
          currentTasks = currentTasks.map((t) => {
            if (t.id === arc.to) {
              return { ...t, dependencies: t.dependencies.filter((d) => d !== arc.from) };
            }
            if (t.id === arc.from) {
              return { ...t, dependencies: [...t.dependencies, arc.to] };
            }
            return t;
          });
          const checkInverted = detectCyclesTarjan(currentTasks);
          if (checkInverted.cycles.length < sccResult.cycles.length) {
            actionsTaken.push(`Inverted feedback arc ${arc.from} -> ${arc.to}`);
            invertedEdges.push(arc);
            sccResult = checkInverted;
            continue;
          }
          currentTasks = currentTasks.map((t) => {
            if (t.id === arc.from) {
              return { ...t, dependencies: t.dependencies.filter((d) => d !== arc.to) };
            }
            return t;
          });
        }

        currentTasks = currentTasks.map((t) => {
          if (t.id === arc.from) {
            const nextDeps = t.dependencies.filter((d) => d !== arc.to);
            return { ...t, dependencies: nextDeps };
          }
          return t;
        });
        actionsTaken.push(`Pruned feedback arc ${arc.from} -> ${arc.to}`);
        removedEdges.push(arc);
      }
      sccResult = detectCyclesTarjan(currentTasks);
    }

    const waves = computeTopologicalWaves(currentTasks);

    return {
      healed: actionsTaken.length > 0 || sccResult.acyclic,
      actionsTaken,
      removedEdges,
      invertedEdges,
      healedTasks: currentTasks,
      waves,
    };
  });
}
