/**
 * DAG Forensics & Layout Mathematical Correctness Subsystem
 *
 * Implements Work/Span mathematics (P = W/S), Brent's Theorem bounds,
 * cycle detection & breaking, deterministic topological ordering,
 * parallel lane allocation, and Unicode DAG layout rendering.
 */
import { isNonblank, isRecord } from "../requirements/predicates.ts";
import { checkScopeOverlap, normalizeScopePath, type ConcurrencyWave, type TaskScopeInput } from "./scope-analyzer.ts";
import { downstreamMap, topologicalOrder, type DependencyMap } from "./topology.ts";

export interface ForensicTaskNode {
  readonly id: string;
  readonly label?: string | undefined;
  readonly effort?: number | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly resourceScope?: readonly string[] | undefined;
  readonly status?: string | undefined;
  readonly priority?: number | undefined;
  readonly gate?: string | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly depReasons?: Readonly<Record<string, string>> | undefined;
}

export interface DependencyEdge {
  readonly source: string;
  readonly target: string;
  readonly type?: string | undefined;
  readonly justification?: string | undefined;
  readonly reason?: string | undefined;
}

export interface CycleBreakCandidate {
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly edgeDescription: string;
  readonly rationale: string;
  readonly cycle: readonly string[];
}

export interface BrentsBoundResult {
  readonly processorCount: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly estimatedTime: number;
  readonly theoreticalSpeedup: number;
  readonly theoreticalEfficiency: number;
}

export interface WorkSpanMetrics {
  readonly totalWork: number;
  readonly criticalSpan: number;
  readonly parallelismFactor: number;
  readonly optimalLanes: number;
  readonly maxSupportedLanes: number;
  readonly criticalPath: readonly string[];
  readonly brentsBounds: readonly BrentsBoundResult[];
}

export interface TaskSlack {
  readonly taskId: string;
  readonly effort: number;
  readonly earliestStartTime: number;
  readonly earliestFinishTime: number;
  readonly latestStartTime: number;
  readonly latestFinishTime: number;
  readonly totalSlack: number;
  readonly isCritical: boolean;
}

export interface ForensicWave {
  readonly waveIndex: number;
  readonly taskIds: readonly string[];
  readonly totalWaveEffort: number;
  readonly maxLaneConcurrency: number;
  readonly hasScopeConflicts: boolean;
}

export interface ParallelLaneAssignment {
  readonly laneIndex: number;
  readonly taskId: string;
  readonly waveIndex: number;
  readonly earliestStartTime?: number | undefined;
  readonly earliestFinishTime?: number | undefined;
}

export interface ArtificialSerializationWarning {
  readonly code: "ARTIFICIAL_SERIALIZATION_WARNING";
  readonly blockedTask: string;
  readonly dependencyTask: string;
  readonly message: string;
  readonly dataflowJustified: boolean;
  readonly sourceScope: readonly string[];
  readonly targetScope: readonly string[];
}

function joinWithAnd(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Checks whether a dependency graph is a valid Directed Acyclic Graph (DAG).
 */
export function isAcyclic(dependencies: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const order = topologicalOrder(dependencies);
  return order.length === dependencies.size;
}

/**
 * Finds all elementary cycles in the dependency graph using DFS with state tracking.
 */
export function findCycles(dependencies: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const allNodes = [...dependencies.keys()].sort();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  function dfs(node: string): void {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    const neighbors = [...(dependencies.get(node) ?? [])].sort();
    for (const neighbor of neighbors) {
      if (!dependencies.has(neighbor)) continue;

      if (inStack.has(neighbor)) {
        const cycleStartIndex = stack.indexOf(neighbor);
        if (cycleStartIndex >= 0) {
          const cycle = stack.slice(cycleStartIndex);
          cycles.push(cycle);
        }
      } else if (!visited.has(neighbor)) {
        dfs(neighbor);
      }
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const node of allNodes) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

/**
 * Describes a dependency cycle in human-readable format and specifies which edge to drop to break it.
 */
export function describeCycle(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  order?: readonly string[],
): string {
  const resolved = new Set(order ?? topologicalOrder(dependencies));
  const unresolved = new Set([...dependencies.keys()].filter((id) => !resolved.has(id)));
  if (unresolved.size === 0) return "no cycle detected";

  for (const start of [...unresolved].sort()) {
    const stack: { node: string; edgeIdx: number; neighbors: string[] }[] = [];
    const inStack = new Set<string>();
    const visited = new Set<string>();

    const startNeighbors = [...(dependencies.get(start) ?? [])]
      .filter((id) => unresolved.has(id))
      .sort();
    stack.push({ node: start, edgeIdx: 0, neighbors: startNeighbors });
    inStack.add(start);
    visited.add(start);

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.edgeIdx < top.neighbors.length) {
        const next = top.neighbors[top.edgeIdx]!;
        top.edgeIdx++;

        if (inStack.has(next)) {
          const cycleNodes: string[] = [];
          const idx = stack.findIndex((item) => item.node === next);
          for (let i = idx; i < stack.length; i++) {
            cycleNodes.push(stack[i]!.node);
          }
          const cycleEdges = cycleNodes.map(
            (id, i) => `${id} --deps ${cycleNodes[(i + 1) % cycleNodes.length]}`,
          );
          return `${joinWithAnd(cycleEdges)} form a cycle; drop ${cycleEdges[0]} to break it`;
        } else if (!visited.has(next)) {
          visited.add(next);
          inStack.add(next);
          const nextNeighbors = [...(dependencies.get(next) ?? [])]
            .filter((id) => unresolved.has(id))
            .sort();
          stack.push({ node: next, edgeIdx: 0, neighbors: nextNeighbors });
        }
      } else {
        inStack.delete(top.node);
        stack.pop();
      }
    }
  }

  return "cycle detected";
}

/**
 * Automatically breaks cycles by removing minimal feedback edges to restore DAG acyclicity.
 */
export function breakCycles(dependencies: ReadonlyMap<string, ReadonlySet<string>>): {
  readonly acyclicDependencies: Map<string, Set<string>>;
  readonly brokenEdges: readonly CycleBreakCandidate[];
} {
  const mutDeps = new Map<string, Set<string>>();
  for (const [k, v] of dependencies) {
    mutDeps.set(k, new Set(v));
  }

  const brokenEdges: CycleBreakCandidate[] = [];

  let safetyCounter = 0;
  const maxIterations = dependencies.size * 2 + 10;

  while (!isAcyclic(mutDeps) && safetyCounter++ < maxIterations) {
    const cycles = findCycles(mutDeps);
    if (cycles.length === 0) {
      // Fallback for unresolved nodes without clean simple cycle
      const order = topologicalOrder(mutDeps);
      const unresolved = [...mutDeps.keys()].filter((id) => !order.includes(id)).sort();
      if (unresolved.length === 0) break;

      const firstUnresolved = unresolved[0]!;
      const prereqs = [...(mutDeps.get(firstUnresolved) ?? [])].sort();
      if (prereqs.length > 0) {
        const dropPrereq = prereqs[0]!;
        mutDeps.get(firstUnresolved)!.delete(dropPrereq);
        brokenEdges.push({
          fromTaskId: firstUnresolved,
          toTaskId: dropPrereq,
          edgeDescription: `${firstUnresolved} --deps ${dropPrereq}`,
          rationale: `Cycle-breaking heuristic: dropped feedback edge ${firstUnresolved} -> ${dropPrereq}`,
          cycle: [firstUnresolved, dropPrereq],
        });
      }
      continue;
    }

    const cycle = cycles[0]!;
    const fromTaskId = cycle[0]!;
    const toTaskId = cycle.length > 1 ? cycle[1]! : cycle[0]!;

    mutDeps.get(fromTaskId)?.delete(toTaskId);
    brokenEdges.push({
      fromTaskId,
      toTaskId,
      edgeDescription: `${fromTaskId} --deps ${toTaskId}`,
      rationale: `Broke cycle [${cycle.join(" -> ")} -> ${cycle[0]}] by dropping edge ${fromTaskId} -> ${toTaskId}`,
      cycle,
    });
  }

  return {
    acyclicDependencies: mutDeps,
    brokenEdges,
  };
}

/**
 * Calculates Brent's theorem bounds and efficiency metrics for p parallel processors.
 * Brent's Theorem: Tp <= floor((W - S) / p) + S
 * Lower bound: Tp >= max(ceil(W / p), S)
 */
export function calculateBrentsTheorem(
  totalWork: number,
  criticalSpan: number,
  processorCount: number,
): BrentsBoundResult {
  const p = Math.max(1, Math.floor(processorCount));
  const W = Math.max(0, totalWork);
  const S = Math.max(1, criticalSpan);

  const lowerBound = Math.max(Math.ceil(W / p), S);
  const upperBound = Math.floor((W - S) / p) + S;
  const estimatedTime = Math.max(lowerBound, Math.min(upperBound, Math.round(W / p + S * (1 - 1 / p))));
  const theoreticalSpeedup = estimatedTime > 0 ? Math.round((W / estimatedTime) * 100) / 100 : 0;
  const theoreticalEfficiency = p > 0 && estimatedTime > 0 ? Math.round((W / (p * estimatedTime)) * 100) / 100 : 0;

  return {
    processorCount: p,
    lowerBound,
    upperBound,
    estimatedTime,
    theoreticalSpeedup,
    theoreticalEfficiency,
  };
}

/**
 * Computes Work ($W$), Span ($S$), Parallelism ($P = W / S$), Critical Path, and Brent's Bounds.
 */
export function computeWorkSpan(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  maxLanes = 40,
): WorkSpanMetrics {
  const effortMap = new Map<string, number>();
  let totalWork = 0;

  for (const task of tasks) {
    const rawEffort = task.effort;
    const effort = typeof rawEffort === "number" && rawEffort > 0 ? rawEffort : 1;
    effortMap.set(task.id, effort);
    totalWork += effort;
  }

  const order = topologicalOrder(dependencies);
  const spanMap = new Map<string, number>();
  const parentOnCriticalPath = new Map<string, string | null>();

  for (const taskId of order) {
    const taskEffort = effortMap.get(taskId) ?? 1;
    const prereqs = dependencies.get(taskId) ?? new Set<string>();
    let maxPrereqSpan = 0;
    let criticalParent: string | null = null;

    for (const prereq of prereqs) {
      const prereqSpan = spanMap.get(prereq) ?? 0;
      if (prereqSpan > maxPrereqSpan) {
        maxPrereqSpan = prereqSpan;
        criticalParent = prereq;
      }
    }

    spanMap.set(taskId, maxPrereqSpan + taskEffort);
    parentOnCriticalPath.set(taskId, criticalParent);
  }

  // Handle any unresolved tasks
  for (const task of tasks) {
    if (!spanMap.has(task.id)) {
      spanMap.set(task.id, effortMap.get(task.id) ?? 1);
      parentOnCriticalPath.set(task.id, null);
    }
  }

  let criticalSpan = 0;
  let criticalEndTask: string | null = null;

  for (const [taskId, span] of spanMap.entries()) {
    if (span > criticalSpan) {
      criticalSpan = span;
      criticalEndTask = taskId;
    }
  }

  const criticalPathReversed: string[] = [];
  let curr = criticalEndTask;
  while (curr) {
    criticalPathReversed.push(curr);
    curr = parentOnCriticalPath.get(curr) ?? null;
  }
  const criticalPath = criticalPathReversed.reverse();

  const parallelismFactor =
    criticalSpan > 0 ? Math.round((totalWork / criticalSpan) * 100) / 100 : tasks.length > 0 ? 1 : 0;

  const optimalLanes = Math.max(1, Math.min(maxLanes, Math.ceil(parallelismFactor > 0 ? parallelismFactor : 1)));

  const standardProcessors = [1, 2, 4, 8, 16, maxLanes].filter((v, i, a) => a.indexOf(v) === i && v <= maxLanes);
  const brentsBounds = standardProcessors.map((p) => calculateBrentsTheorem(totalWork, criticalSpan, p));

  return {
    totalWork,
    criticalSpan,
    parallelismFactor,
    optimalLanes,
    maxSupportedLanes: maxLanes,
    criticalPath,
    brentsBounds,
  };
}

/**
 * Computes Earliest Start Time (EST), Earliest Finish Time (EFT),
 * Latest Start Time (LST), Latest Finish Time (LFT), and Total Slack for each task.
 * Critical path tasks have Slack = 0.
 */
export function computeTaskSlack(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, TaskSlack> {
  const effortMap = new Map<string, number>();
  for (const t of tasks) {
    effortMap.set(t.id, typeof t.effort === "number" && t.effort > 0 ? t.effort : 1);
  }

  const order = topologicalOrder(dependencies);
  const estMap = new Map<string, number>();
  const eftMap = new Map<string, number>();

  // Forward pass: calculate EST and EFT
  for (const id of order) {
    const effort = effortMap.get(id) ?? 1;
    const prereqs = dependencies.get(id) ?? new Set<string>();
    let maxEft = 0;
    for (const p of prereqs) {
      const pEft = eftMap.get(p) ?? 0;
      if (pEft > maxEft) maxEft = pEft;
    }
    estMap.set(id, maxEft);
    eftMap.set(id, maxEft + effort);
  }

  let totalSpan = 0;
  for (const eft of eftMap.values()) {
    if (eft > totalSpan) totalSpan = eft;
  }

  const downstream = downstreamMap(dependencies);
  const lstMap = new Map<string, number>();
  const lftMap = new Map<string, number>();

  // Backward pass: calculate LFT and LST
  const reversedOrder = [...order].reverse();
  for (const id of reversedOrder) {
    const effort = effortMap.get(id) ?? 1;
    const children = downstream.get(id) ?? new Set<string>();
    let minLst = totalSpan;
    for (const c of children) {
      const cLst = lstMap.get(c) ?? totalSpan;
      if (cLst < minLst) minLst = cLst;
    }
    lftMap.set(id, minLst);
    lstMap.set(id, minLst - effort);
  }

  const result = new Map<string, TaskSlack>();
  for (const t of tasks) {
    const effort = effortMap.get(t.id) ?? 1;
    const est = estMap.get(t.id) ?? 0;
    const eft = eftMap.get(t.id) ?? effort;
    const lft = lftMap.get(t.id) ?? totalSpan;
    const lst = lstMap.get(t.id) ?? totalSpan - effort;
    const totalSlack = Math.max(0, lst - est);
    const isCritical = totalSlack === 0;

    result.set(t.id, {
      taskId: t.id,
      effort,
      earliestStartTime: est,
      earliestFinishTime: eft,
      latestStartTime: lst,
      latestFinishTime: lft,
      totalSlack,
      isCritical,
    });
  }

  return result;
}

/**
 * Computes topological execution waves for a set of tasks.
 */
export function computeTopologicalWaves(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): ForensicWave[] {
  const remaining = new Map<string, number>();
  const taskMap = new Map<string, ForensicTaskNode>();

  for (const t of tasks) {
    taskMap.set(t.id, t);
    const deps = dependencies.get(t.id) ?? new Set<string>();
    remaining.set(t.id, deps.size);
  }

  const waveMap = new Map<string, number>();
  let currentWave = 1;
  const processed = new Set<string>();

  while (processed.size < tasks.length) {
    const readyInThisWave: string[] = [];
    for (const t of tasks) {
      if (processed.has(t.id)) continue;
      const prereqs = dependencies.get(t.id) ?? new Set<string>();
      const allPrereqsDone = [...prereqs].every((p) => waveMap.has(p));
      if (allPrereqsDone) {
        readyInThisWave.push(t.id);
      }
    }

    if (readyInThisWave.length === 0) {
      for (const t of tasks) {
        if (!processed.has(t.id)) {
          waveMap.set(t.id, currentWave);
          processed.add(t.id);
        }
      }
      break;
    }

    readyInThisWave.sort();
    for (const id of readyInThisWave) {
      waveMap.set(id, currentWave);
      processed.add(id);
    }
    currentWave++;
  }

  const maxWave = Math.max(1, currentWave - 1);
  const waves: ForensicWave[] = [];

  for (let w = 1; w <= maxWave; w++) {
    const waveTasks = tasks.filter((t) => waveMap.get(t.id) === w);
    if (waveTasks.length === 0) continue;

    const taskIds = waveTasks.map((t) => t.id);
    const totalWaveEffort = waveTasks.reduce((acc, t) => acc + (t.effort ?? 1), 0);

    let hasConflicts = false;
    for (let i = 0; i < waveTasks.length; i++) {
      for (let j = i + 1; j < waveTasks.length; j++) {
        const scopesA = waveTasks[i]!.writeScope ?? [];
        const scopesB = waveTasks[j]!.writeScope ?? [];
        if (checkScopeOverlap(scopesA, scopesB).hasOverlap) {
          hasConflicts = true;
          break;
        }
      }
      if (hasConflicts) break;
    }

    waves.push({
      waveIndex: w,
      taskIds,
      totalWaveEffort,
      maxLaneConcurrency: waveTasks.length,
      hasScopeConflicts: hasConflicts,
    });
  }

  return waves;
}

/**
 * Allocates tasks into parallel execution lanes (0 to maxLanes - 1) per wave.
 */
export function allocateParallelLanes(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  maxLanes = 40,
): readonly ParallelLaneAssignment[] {
  const waves = computeTopologicalWaves(tasks, dependencies);
  const slackMap = computeTaskSlack(tasks, dependencies);
  const assignments: ParallelLaneAssignment[] = [];

  for (const wave of waves) {
    wave.taskIds.forEach((taskId, index) => {
      const laneIndex = index % maxLanes;
      const slack = slackMap.get(taskId);
      assignments.push({
        laneIndex,
        taskId,
        waveIndex: wave.waveIndex,
        earliestStartTime: slack?.earliestStartTime,
        earliestFinishTime: slack?.earliestFinishTime,
      });
    });
  }

  return assignments;
}

/**
 * Detects tasks serialized behind others when their write scopes are completely disjoint
 * and no explicit dataflow justification is provided.
 */
export function detectArtificialSerialization(
  tasks: readonly ForensicTaskNode[],
  justificationsByEdge: ReadonlyMap<string, string> = new Map(),
): ArtificialSerializationWarning[] {
  const normalizedTasks = tasks.map((t) => ({
    taskId: t.id,
    writeScope: (t.writeScope ?? []).map(normalizeScopePath),
    dependencies: (t.dependencies ?? []).filter(isNonblank),
    depReasons: t.depReasons ?? {},
  }));

  const warnings: ArtificialSerializationWarning[] = [];
  for (const task of normalizedTasks) {
    for (const depId of task.dependencies) {
      const depTask = normalizedTasks.find((t) => t.taskId === depId);
      if (!depTask) continue;

      const overlap = checkScopeOverlap(task.writeScope, depTask.writeScope);
      const edgeKey = `${task.taskId}->${depTask.taskId}`;
      const justification = justificationsByEdge.get(edgeKey) ?? task.depReasons[depId];
      const hasJustification = typeof justification === "string" && justification.trim().length > 0;

      if (!overlap.hasOverlap) {
        warnings.push({
          code: "ARTIFICIAL_SERIALIZATION_WARNING",
          blockedTask: task.taskId,
          dependencyTask: depTask.taskId,
          message:
            `Task ${task.taskId} is artificially serialized behind ${depTask.taskId} with disjoint write scopes ` +
            `([${task.writeScope.join(", ")}] vs [${depTask.writeScope.join(", ")}])` +
            (hasJustification
              ? ` despite declared justification: ${justification}`
              : " and no dataflow justification."),
          dataflowJustified: hasJustification,
          sourceScope: task.writeScope,
          targetScope: depTask.writeScope,
        });
      }
    }
  }
  return warnings;
}

/**
 * Renders the DAG into Mermaid flowchart format.
 */
export function renderMermaidDag(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const lines: string[] = ["graph TD"];

  for (const task of tasks) {
    const label = task.label ? `${task.id}["${task.id}: ${task.label}"]` : task.id;
    lines.push(`  ${label}`);
  }

  for (const [taskId, prereqs] of dependencies) {
    for (const prereq of prereqs) {
      lines.push(`  ${prereq} --> ${taskId}`);
    }
  }

  return lines.join("\n");
}

export {
  topologicalOrder,
  downstreamMap,
  type DependencyMap,
} from "./topology.ts";
