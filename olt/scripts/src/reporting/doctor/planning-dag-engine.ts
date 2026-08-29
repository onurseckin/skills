import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export type PlanningDagDependencyItem =
  | string
  | { readonly id?: string | undefined; readonly optional?: boolean | undefined };

export interface PlanningDagNodeInput {
  readonly id: string;
  readonly dependencies?: readonly PlanningDagDependencyItem[] | undefined;
  readonly deps?: readonly PlanningDagDependencyItem[] | undefined;
  readonly status?: string | undefined;
}

export interface PlanningDagEdgeInput {
  readonly from: string;
  readonly to: string;
}

export interface PlanningDagGraphInput {
  readonly nodes?: readonly (PlanningDagNodeInput | unknown)[] | undefined;
  readonly edges?: readonly (PlanningDagEdgeInput | unknown)[] | undefined;
}

export interface PlanningDagCheckOptions {
  readonly tasks?: Readonly<Record<string, unknown>> | null | undefined;
  readonly graph?: PlanningDagGraphInput | null | undefined;
}

export interface TaskNodeInfo {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly status?: string | undefined;
}

export function extractDependencyId(item: unknown): string | undefined {
  if (typeof item === "string") {
    const trimmed = item.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof item === "object" && item !== null && "id" in item) {
    const raw = (item as { readonly id?: unknown }).id;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  }
  return undefined;
}

export function extractDependencyList(rawDeps: unknown): readonly string[] {
  if (!Array.isArray(rawDeps)) {
    return [];
  }
  const result: string[] = [];
  for (const item of rawDeps) {
    const depId = extractDependencyId(item);
    if (depId !== undefined) {
      result.push(depId);
    }
  }
  return result;
}

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

export function checkPlanningDag(options: PlanningDagCheckOptions = {}): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const nodesMap = new Map<string, TaskNodeInfo>();

  if (options.tasks && typeof options.tasks === "object") {
    for (const [key, value] of Object.entries(options.tasks)) {
      if (value && typeof value === "object") {
        const rec = value as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id : key;
        const deps = extractDependencyList(rec.dependencies ?? rec.deps);
        const status = typeof rec.status === "string" ? rec.status : undefined;
        nodesMap.set(id, { id, dependencies: deps, status });
      }
    }
  }

  if (options.graph && typeof options.graph === "object") {
    if (Array.isArray(options.graph.nodes)) {
      for (const node of options.graph.nodes) {
        if (
          node &&
          typeof node === "object" &&
          "id" in node &&
          typeof (node as { readonly id?: unknown }).id === "string"
        ) {
          const rawNode = node as {
            readonly id: string;
            readonly dependencies?: unknown;
            readonly deps?: unknown;
            readonly status?: unknown;
          };
          const existing = nodesMap.get(rawNode.id);
          const rawDependencies = rawNode.dependencies ?? rawNode.deps;
          const deps =
            rawDependencies !== undefined
              ? extractDependencyList(rawDependencies)
              : (existing?.dependencies ?? []);
          const status = typeof rawNode.status === "string" ? rawNode.status : existing?.status;
          nodesMap.set(rawNode.id, {
            id: rawNode.id,
            dependencies: deps,
            status,
          });
        }
      }
    }
    if (Array.isArray(options.graph.edges)) {
      for (const edge of options.graph.edges) {
        if (
          edge &&
          typeof edge === "object" &&
          "from" in edge &&
          "to" in edge &&
          typeof (edge as { readonly from?: unknown }).from === "string" &&
          typeof (edge as { readonly to?: unknown }).to === "string"
        ) {
          const typedEdge = edge as { readonly from: string; readonly to: string };
          const target = nodesMap.get(typedEdge.to);
          if (target) {
            if (!target.dependencies.includes(typedEdge.from)) {
              nodesMap.set(typedEdge.to, {
                ...target,
                dependencies: [...target.dependencies, typedEdge.from],
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
    passed: findings.filter((f: DoctorDiagnosticFinding) => f.severity === "ERROR").length === 0,
    findings,
  };
}
