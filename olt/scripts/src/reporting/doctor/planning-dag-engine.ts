import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface PlanningDagCheckOptions {
  readonly tasks?: Readonly<Record<string, unknown>> | null | undefined;
  readonly graph?:
    | {
        readonly nodes?:
          | readonly { readonly id: string; readonly dependencies?: readonly string[] }[]
          | undefined;
        readonly edges?: readonly { readonly from: string; readonly to: string }[] | undefined;
      }
    | null
    | undefined;
}

interface TaskNodeInfo {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly status?: string | undefined;
}

/**
 * Tarjan's Strongly Connected Components Algorithm for cycle detection.
 */
function findCycles(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
  let indexCounter = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(v: string) {
    indices.set(v, indexCounter);
    lowlinks.set(v, indexCounter);
    indexCounter += 1;
    stack.push(v);
    onStack.add(v);

    const neighbors = adjacency.get(v) ?? [];
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        const vLow = lowlinks.get(v)!;
        const wLow = lowlinks.get(w)!;
        lowlinks.set(v, Math.min(vLow, wLow));
      } else if (onStack.has(w)) {
        const vLow = lowlinks.get(v)!;
        const wIndex = indices.get(w)!;
        lowlinks.set(v, Math.min(vLow, wIndex));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w = "";
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      if (scc.length > 1) {
        sccs.push(scc);
      } else if (scc.length === 1 && (adjacency.get(scc[0]!) ?? []).includes(scc[0]!)) {
        // Self-loop
        sccs.push(scc);
      }
    }
  }

  for (const nodeId of nodeIds) {
    if (!indices.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  return sccs;
}

/**
 * Engine 1: checkPlanningDag
 * Validates task dependencies, cycle detection (Tarjan), orphan/unreachable tasks, and missing dependency links.
 */
export function checkPlanningDag(options: PlanningDagCheckOptions = {}): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const nodesMap = new Map<string, TaskNodeInfo>();

  // Extract from options.tasks
  if (options.tasks && typeof options.tasks === "object") {
    for (const [key, value] of Object.entries(options.tasks)) {
      if (value && typeof value === "object") {
        const rec = value as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id : key;
        const deps = Array.isArray(rec.dependencies)
          ? rec.dependencies.filter((d): d is string => typeof d === "string")
          : Array.isArray(rec.deps)
            ? rec.deps.filter((d): d is string => typeof d === "string")
            : [];
        const status = typeof rec.status === "string" ? rec.status : undefined;
        nodesMap.set(id, { id, dependencies: deps, status });
      }
    }
  }

  // Extract from options.graph
  if (options.graph && typeof options.graph === "object") {
    if (Array.isArray(options.graph.nodes)) {
      for (const node of options.graph.nodes) {
        if (node && typeof node === "object" && typeof node.id === "string") {
          const existing = nodesMap.get(node.id);
          const deps = Array.isArray(node.dependencies)
            ? (node.dependencies as readonly (string | { id?: string })[])
                .map((d: { id?: string } | string) => (typeof d === "string" ? d : d?.id))
                .filter((d): d is string => typeof d === "string")
            : (existing?.dependencies ?? []);
          nodesMap.set(node.id, {
            id: node.id,
            dependencies: deps,
            status: existing?.status,
          });
        }
      }
    }
    if (Array.isArray(options.graph.edges)) {
      for (const edge of options.graph.edges) {
        if (
          edge &&
          typeof edge === "object" &&
          typeof edge.from === "string" &&
          typeof edge.to === "string"
        ) {
          const target = nodesMap.get(edge.to);
          if (target) {
            if (!target.dependencies.includes(edge.from)) {
              nodesMap.set(edge.to, {
                ...target,
                dependencies: [...target.dependencies, edge.from],
              });
            }
          }
        }
      }
    }
  }

  const allNodeIds = Array.from(nodesMap.keys());
  const allNodeSet = new Set(allNodeIds);
  const adjacency = new Map<string, string[]>();

  // 1. Validate missing dependency links
  for (const [id, node] of nodesMap.entries()) {
    const validDeps: string[] = [];
    for (const depId of node.dependencies) {
      if (!allNodeSet.has(depId)) {
        findings.push({
          code: "PLANNING_DAG_MISSING_DEPENDENCY",
          severity: "ERROR",
          engine: "checkPlanningDag",
          message: `Task "${id}" references missing dependency "${depId}"`,
          details: { taskId: id, missingDependencyId: depId },
        });
      } else {
        validDeps.push(depId);
      }
    }
    adjacency.set(id, validDeps);
  }

  // 2. Validate cycles via Tarjan
  const cycles = findCycles(allNodeIds, adjacency);
  for (const cycle of cycles) {
    const cycleStr = cycle.join(" -> ") + ` -> ${cycle[0]}`;
    findings.push({
      code: "PLANNING_DAG_CYCLE_DETECTED",
      severity: "ERROR",
      engine: "checkPlanningDag",
      message: `Cycle detected in planning DAG: ${cycleStr}`,
      details: { cycleNodes: cycle },
    });
  }

  // 3. Validate orphan / unreachable tasks
  // An orphan is a task with no dependents and no dependencies when multiple tasks exist
  if (allNodeIds.length > 1) {
    const isTargetSet = new Set<string>();
    for (const deps of adjacency.values()) {
      for (const d of deps) {
        isTargetSet.add(d);
      }
    }
    for (const id of allNodeIds) {
      const deps = adjacency.get(id) ?? [];
      const hasOutgoing = deps.length > 0;
      const hasIncoming = isTargetSet.has(id);
      if (!hasOutgoing && !hasIncoming) {
        findings.push({
          code: "PLANNING_DAG_ORPHAN_TASK",
          severity: "WARN",
          engine: "checkPlanningDag",
          message: `Orphan task with no dependencies and no dependents detected: "${id}"`,
          details: { taskId: id },
        });
      }
    }
  }

  return {
    engine: "checkPlanningDag",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
  };
}
