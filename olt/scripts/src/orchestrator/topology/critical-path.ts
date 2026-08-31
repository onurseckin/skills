import type { SynthesizedTaskSpec } from "./types.ts";

export function computeCriticalPath(
  tasks: readonly SynthesizedTaskSpec[],
  order: readonly string[],
): { readonly criticalPath: readonly string[]; readonly criticalDepth: number } {
  if (tasks.length === 0) {
    return { criticalPath: [], criticalDepth: 0 };
  }

  const taskMap = new Map<string, SynthesizedTaskSpec>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const longestPathTo = new Map<string, { path: string[]; depth: number }>();

  for (const id of order) {
    const task = taskMap.get(id);
    const rawDeps = task !== undefined && task.dependencies !== undefined ? task.dependencies : [];
    const deps = rawDeps.map((d) => d.trim()).filter(Boolean);

    let maxPrereqDepth = 0;
    let bestPrereqPath: string[] = [];

    for (const dep of deps) {
      const prereqInfo = longestPathTo.get(dep);
      if (prereqInfo && prereqInfo.depth > maxPrereqDepth) {
        maxPrereqDepth = prereqInfo.depth;
        bestPrereqPath = prereqInfo.path;
      }
    }

    const currentDepth = maxPrereqDepth + 1;
    const currentPath = [...bestPrereqPath, id];
    longestPathTo.set(id, { path: currentPath, depth: currentDepth });
  }

  let criticalDepth = 0;
  let criticalPath: string[] = [];

  for (const info of longestPathTo.values()) {
    if (info.depth > criticalDepth) {
      criticalDepth = info.depth;
      criticalPath = info.path;
    }
  }

  return { criticalPath, criticalDepth };
}
