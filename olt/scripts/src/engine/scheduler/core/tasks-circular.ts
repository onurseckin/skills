import { CircularDependenciesProbeResult } from "./types.ts";
import { graphParts } from "../../../graph/parts";
import { dependencyData } from "../../../graph/topology";
import { isRecord } from "../../store/layout/layout-json.ts";

export function probeCircularDependencies(state: unknown): CircularDependenciesProbeResult {
  const cycles: string[][] = [];
  const cycleDescriptions: string[] = [];
  const details: string[] = [];

  if (!isRecord(state)) {
    return { passed: true, hasCycles: false, cycles: [], cycleDescriptions: [], details: [] };
  }

  // Build dependency map from graph or tasks
  const deps = new Map<string, Set<string>>();

  if (isRecord(state.graph)) {
    try {
      const { nodes, edges } = graphParts(state.graph);
      const depData = dependencyData(nodes, edges);
      if (depData.issues.length > 0) {
        for (const issue of depData.issues) {
          if (issue.includes("cycle") || issue.includes("cannot depend on itself")) {
            cycleDescriptions.push(issue);
            details.push(issue);
          }
        }
      }
      for (const [k, v] of depData.dependencies) {
        deps.set(k, new Set(v));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      cycleDescriptions.push(msg);
      details.push(msg);
    }
  } else if (isRecord(state.tasks)) {
    for (const [taskId, rawTask] of Object.entries(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      const taskDeps = Array.isArray(rawTask.dependencies) ? rawTask.dependencies : [];
      const set = new Set<string>();
      for (const d of taskDeps) {
        if (typeof d === "string") {
          if (d === taskId) {
            const selfDesc = `Task '${taskId}' has self-dependency on itself.`;
            cycleDescriptions.push(selfDesc);
            details.push(selfDesc);
          } else {
            set.add(d);
          }
        }
      }
      deps.set(taskId, set);
    }
  }

  // Perform DFS cycle check
  const visited = new Map<string, "visiting" | "visited">();
  const path: string[] = [];

  function dfs(node: string) {
    visited.set(node, "visiting");
    path.push(node);

    const prerequisites = deps.get(node) ?? new Set<string>();
    for (const neighbor of prerequisites) {
      const status = visited.get(neighbor);
      if (status === "visiting") {
        const cycleStartIndex = path.indexOf(neighbor);
        const cycle = path.slice(cycleStartIndex).concat(neighbor);
        cycles.push(cycle);
        const desc = `Cycle detected: ${cycle.join(" -> ")}`;
        if (!cycleDescriptions.includes(desc)) {
          cycleDescriptions.push(desc);
          details.push(desc);
        }
      } else if (!status) {
        dfs(neighbor);
      }
    }

    path.pop();
    visited.set(node, "visited");
  }

  for (const node of deps.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  const hasCycles = cycles.length > 0 || cycleDescriptions.length > 0;

  return {
    passed: !hasCycles,
    hasCycles,
    cycles,
    cycleDescriptions,
    details,
  };
}
