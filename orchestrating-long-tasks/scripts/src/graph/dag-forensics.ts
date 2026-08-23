/**
 * DAG Forensics & Layout Mathematical Correctness Subsystem
 *
 * Implements Work/Span mathematics (P = W/S), Brent's Theorem bounds,
 * Critical Path Drag analysis, Fan-Out bottleneck detection,
 * queue stall / serialization justification diagnostics,
 * cycle detection & breaking, deterministic topological ordering,
 * parallel lane allocation, and Unicode & Mermaid rendering.
 */
import { isNonblank } from "../requirements/predicates.ts";
import { checkScopeOverlap, normalizeScopePath } from "./scope-analyzer.ts";
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

export interface CriticalPathDrag {
  readonly taskId: string;
  readonly effort: number;
  readonly isCritical: boolean;
  readonly drag: number;
  readonly dragPercentage: number;
  readonly dragCostSummary: string;
}

export interface FanOutBottleneck {
  readonly taskId: string;
  readonly fanOutCount: number;
  readonly downstreamTaskIds: readonly string[];
  readonly blockedEffort: number;
  readonly isCritical: boolean;
  readonly severity: "high" | "medium" | "low";
  readonly impactDescription: string;
}

export interface QueueStallAnalysis {
  readonly blockedTaskId: string;
  readonly blockerTaskId: string;
  readonly stallDuration: number;
  readonly writeScopeDisjoint: boolean;
  readonly isDataflowJustified: boolean;
  readonly depReason: string | undefined;
  readonly isCriticalStall: boolean;
  readonly recommendation: string;
}

export interface WorkSpanMetrics {
  readonly totalWork: number;
  readonly criticalSpan: number;
  readonly parallelismFactor: number;
  readonly optimalLanes: number;
  readonly maxSupportedLanes: number;
  readonly criticalPath: readonly string[];
  readonly brentsBounds: readonly BrentsBoundResult[];
  readonly drags: readonly CriticalPathDrag[];
  readonly fanOutBottlenecks: readonly FanOutBottleneck[];
  readonly queueStalls: readonly QueueStallAnalysis[];
}

export interface TaskSlack {
  readonly taskId: string;
  readonly effort: number;
  readonly earliestStartTime: number;
  readonly earliestFinishTime: number;
  readonly latestStartTime: number;
  readonly latestFinishTime: number;
  readonly totalSlack: number;
  readonly freeSlack: number;
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

function extractNeighbors(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  nodeId: string,
): string[] {
  const set = dependencies.get(nodeId);
  if (set !== undefined) {
    return Array.from(set).sort();
  }
  return [];
}

function extractEffort(task: ForensicTaskNode): number {
  if (typeof task.effort === "number" && task.effort >= 0) {
    return task.effort;
  }
  return 1;
}

function extractEffortById(effortMap: ReadonlyMap<string, number>, taskId: string): number {
  const val = effortMap.get(taskId);
  if (typeof val === "number" && val >= 0) {
    return val;
  }
  return 1;
}

function joinWithAnd(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) {
    const single = items[0];
    if (single !== undefined) return single;
    return "";
  }
  if (items.length === 2) {
    const first = items[0];
    const second = items[1];
    if (first !== undefined && second !== undefined) {
      return `${first} and ${second}`;
    }
    return "";
  }
  const last = items[items.length - 1];
  const rest = items.slice(0, -1);
  if (last !== undefined) {
    return `${rest.join(", ")}, and ${last}`;
  }
  return items.join(", ");
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
  const allNodes = Array.from(dependencies.keys()).sort();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  function dfs(node: string): void {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    const neighbors = extractNeighbors(dependencies, node);
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
  order?: readonly string[] | undefined,
): string {
  let resolvedList: readonly string[];
  if (order !== undefined) {
    resolvedList = order;
  } else {
    resolvedList = topologicalOrder(dependencies);
  }
  const resolved = new Set(resolvedList);
  const unresolved = new Set(Array.from(dependencies.keys()).filter((id) => !resolved.has(id)));
  if (unresolved.size === 0) return "no cycle detected";

  const unresolvedSorted = Array.from(unresolved).sort();
  for (const start of unresolvedSorted) {
    const stack: { node: string; edgeIdx: number; neighbors: string[] }[] = [];
    const inStack = new Set<string>();
    const visited = new Set<string>();

    const startNeighbors = extractNeighbors(dependencies, start).filter((id) => unresolved.has(id));
    stack.push({ node: start, edgeIdx: 0, neighbors: startNeighbors });
    inStack.add(start);
    visited.add(start);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === undefined) break;

      if (top.edgeIdx < top.neighbors.length) {
        const next = top.neighbors[top.edgeIdx];
        top.edgeIdx += 1;
        if (next === undefined) continue;

        if (inStack.has(next)) {
          const cycleNodes: string[] = [];
          const idx = stack.findIndex((item) => item.node === next);
          if (idx >= 0) {
            for (let i = idx; i < stack.length; i++) {
              const item = stack[i];
              if (item !== undefined) {
                cycleNodes.push(item.node);
              }
            }
          }
          const cycleEdges: string[] = [];
          for (let i = 0; i < cycleNodes.length; i++) {
            const current = cycleNodes[i];
            const nextNode = cycleNodes[(i + 1) % cycleNodes.length];
            if (current !== undefined && nextNode !== undefined) {
              cycleEdges.push(`${current} --deps ${nextNode}`);
            }
          }
          const firstEdge = cycleEdges[0];
          const edgeToDrop = firstEdge !== undefined ? firstEdge : "feedback edge";
          return `${joinWithAnd(cycleEdges)} form a cycle; drop ${edgeToDrop} to break it`;
        } else if (!visited.has(next)) {
          visited.add(next);
          inStack.add(next);
          const nextNeighbors = extractNeighbors(dependencies, next).filter((id) => unresolved.has(id));
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

  while (!isAcyclic(mutDeps) && safetyCounter < maxIterations) {
    safetyCounter += 1;
    const cycles = findCycles(mutDeps);
    if (cycles.length === 0) {
      const order = topologicalOrder(mutDeps);
      const unresolved = Array.from(mutDeps.keys())
        .filter((id) => !order.includes(id))
        .sort();
      if (unresolved.length === 0) break;

      const firstUnresolved = unresolved[0];
      if (firstUnresolved !== undefined) {
        const prereqs = extractNeighbors(mutDeps, firstUnresolved);
        if (prereqs.length > 0) {
          const dropPrereq = prereqs[0];
          if (dropPrereq !== undefined) {
            const targetSet = mutDeps.get(firstUnresolved);
            if (targetSet !== undefined) {
              targetSet.delete(dropPrereq);
            }
            brokenEdges.push({
              fromTaskId: firstUnresolved,
              toTaskId: dropPrereq,
              edgeDescription: `${firstUnresolved} --deps ${dropPrereq}`,
              rationale: `Cycle-breaking heuristic: dropped feedback edge ${firstUnresolved} -> ${dropPrereq}`,
              cycle: [firstUnresolved, dropPrereq],
            });
          }
        }
      }
      continue;
    }

    const cycle = cycles[0];
    if (cycle === undefined) break;
    if (cycle.length === 0) break;

    const fromTaskId = cycle[0];
    let toTaskId = cycle[0];
    if (cycle.length > 1) {
      const second = cycle[1];
      if (second !== undefined) {
        toTaskId = second;
      }
    }

    if (fromTaskId !== undefined && toTaskId !== undefined) {
      const set = mutDeps.get(fromTaskId);
      if (set !== undefined) {
        set.delete(toTaskId);
      }
      const firstCycleNode = cycle[0];
      const loopBack = firstCycleNode !== undefined ? firstCycleNode : fromTaskId;
      brokenEdges.push({
        fromTaskId,
        toTaskId,
        edgeDescription: `${fromTaskId} --deps ${toTaskId}`,
        rationale: `Broke cycle [${cycle.join(" -> ")} -> ${loopBack}] by dropping edge ${fromTaskId} -> ${toTaskId}`,
        cycle,
      });
    }
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

function internalComputeSpan(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  overrideEffort?: ReadonlyMap<string, number> | undefined,
): {
  spanMap: Map<string, number>;
  criticalSpan: number;
  criticalPath: string[];
} {
  const effortMap = new Map<string, number>();
  for (const task of tasks) {
    if (overrideEffort !== undefined && overrideEffort.has(task.id)) {
      const ov = overrideEffort.get(task.id);
      if (typeof ov === "number") {
        effortMap.set(task.id, Math.max(0, ov));
      } else {
        effortMap.set(task.id, extractEffort(task));
      }
    } else {
      effortMap.set(task.id, extractEffort(task));
    }
  }

  const order = topologicalOrder(dependencies);
  const spanMap = new Map<string, number>();
  const parentOnCriticalPath = new Map<string, string | null>();

  for (const taskId of order) {
    const taskEffort = extractEffortById(effortMap, taskId);
    const prereqs = extractNeighbors(dependencies, taskId);
    let maxPrereqSpan = 0;
    let criticalParent: string | null = null;

    for (const prereq of prereqs) {
      const pSpan = spanMap.get(prereq);
      const prereqSpan = typeof pSpan === "number" ? pSpan : 0;
      if (prereqSpan > maxPrereqSpan) {
        maxPrereqSpan = prereqSpan;
        criticalParent = prereq;
      }
    }

    spanMap.set(taskId, maxPrereqSpan + taskEffort);
    parentOnCriticalPath.set(taskId, criticalParent);
  }

  for (const task of tasks) {
    if (!spanMap.has(task.id)) {
      spanMap.set(task.id, extractEffortById(effortMap, task.id));
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
  while (curr !== null) {
    criticalPathReversed.push(curr);
    const next = parentOnCriticalPath.get(curr);
    if (next !== undefined && next !== null) {
      curr = next;
    } else {
      curr = null;
    }
  }
  const criticalPath = criticalPathReversed.reverse();

  return { spanMap, criticalSpan, criticalPath };
}

/**
 * Computes Critical Path Drag for all tasks in the DAG.
 * Drag of task T = ProjectSpan - ProjectSpan(effort_T = 0).
 * If T is not on the critical path, Drag = 0.
 */
export function computeCriticalPathDrag(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): CriticalPathDrag[] {
  const base = internalComputeSpan(tasks, dependencies);
  const criticalSet = new Set(base.criticalPath);
  const results: CriticalPathDrag[] = [];

  for (const task of tasks) {
    const effort = extractEffort(task);
    const isCritical = criticalSet.has(task.id);

    if (!isCritical) {
      results.push({
        taskId: task.id,
        effort,
        isCritical: false,
        drag: 0,
        dragPercentage: 0,
        dragCostSummary: `Task ${task.id} has 0 drag (non-critical, slack > 0).`,
      });
      continue;
    }

    if (base.criticalSpan <= 0) {
      results.push({
        taskId: task.id,
        effort,
        isCritical: true,
        drag: 0,
        dragPercentage: 0,
        dragCostSummary: `Task ${task.id} has 0 drag (total span is 0).`,
      });
      continue;
    }

    // Counterfactual: set task effort to 0 and compute resulting critical span
    const override = new Map<string, number>([[task.id, 0]]);
    const counterfactual = internalComputeSpan(tasks, dependencies, override);
    const drag = Math.max(0, base.criticalSpan - counterfactual.criticalSpan);
    const dragPercentage = base.criticalSpan > 0 ? Math.round((drag / base.criticalSpan) * 10000) / 100 : 0;

    results.push({
      taskId: task.id,
      effort,
      isCritical: true,
      drag,
      dragPercentage,
      dragCostSummary:
        `Task ${task.id} exerts ${drag} units of critical path drag (${dragPercentage}% of total span ${base.criticalSpan}). ` +
        `Shortening ${task.id} by ${drag} reduces total project duration to ${counterfactual.criticalSpan}.`,
    });
  }

  return results;
}

/**
 * Identifies fan-out bottlenecks where single upstream tasks gate multiple concurrent downstream tasks.
 */
export function detectFanOutBottlenecks(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  threshold = 2,
): FanOutBottleneck[] {
  const downstream = downstreamMap(dependencies);
  const taskMap = new Map<string, ForensicTaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const base = internalComputeSpan(tasks, dependencies);
  const criticalSet = new Set(base.criticalPath);
  const bottlenecks: FanOutBottleneck[] = [];

  for (const task of tasks) {
    const directDownstreamSet = downstream.get(task.id);
    const directDownstream: string[] = [];
    if (directDownstreamSet !== undefined) {
      for (const id of directDownstreamSet) {
        directDownstream.push(id);
      }
    }
    directDownstream.sort();

    const fanOutCount = directDownstream.length;
    if (fanOutCount >= threshold) {
      let blockedEffort = 0;
      for (const downId of directDownstream) {
        const downTask = taskMap.get(downId);
        if (downTask !== undefined) {
          blockedEffort += extractEffort(downTask);
        } else {
          blockedEffort += 1;
        }
      }

      const isCritical = criticalSet.has(task.id);
      let severity: "high" | "medium" | "low";
      if (fanOutCount >= 4) {
        severity = "high";
      } else if (isCritical && fanOutCount >= 3) {
        severity = "high";
      } else if (fanOutCount >= 2) {
        severity = "medium";
      } else {
        severity = "low";
      }

      bottlenecks.push({
        taskId: task.id,
        fanOutCount,
        downstreamTaskIds: directDownstream,
        blockedEffort,
        isCritical,
        severity,
        impactDescription:
          `Task ${task.id} gates ${fanOutCount} downstream tasks totaling ${blockedEffort} work units ` +
          `(${isCritical ? "ON critical path" : "off critical path"}, severity: ${severity}).`,
      });
    }
  }

  return bottlenecks;
}

/**
 * Analyzes serialization justifications between tasks and detects potential queue stalls.
 */
export function analyzeQueueStalls(
  tasks: readonly ForensicTaskNode[],
  justificationsByEdge: ReadonlyMap<string, string> = new Map(),
): QueueStallAnalysis[] {
  const taskMap = new Map<string, ForensicTaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const stalls: QueueStallAnalysis[] = [];

  for (const task of tasks) {
    const rawDeps = task.dependencies;
    const deps: string[] = [];
    if (rawDeps !== undefined) {
      for (const d of rawDeps) {
        if (isNonblank(d)) {
          deps.push(d);
        }
      }
    }

    const taskScopes = (task.writeScope !== undefined ? task.writeScope : []).map(normalizeScopePath);

    for (const blockerId of deps) {
      const blocker = taskMap.get(blockerId);
      if (blocker === undefined) continue;

      const blockerScopes = (blocker.writeScope !== undefined ? blocker.writeScope : []).map(normalizeScopePath);
      const overlap = checkScopeOverlap(taskScopes, blockerScopes);
      const edgeKey = `${task.id}->${blockerId}`;

      let depReason: string | undefined = undefined;
      const explicitJustification = justificationsByEdge.get(edgeKey);
      if (typeof explicitJustification === "string" && explicitJustification.trim().length > 0) {
        depReason = explicitJustification.trim();
      } else if (task.depReasons !== undefined) {
        const fromTaskReason = task.depReasons[blockerId];
        if (typeof fromTaskReason === "string" && fromTaskReason.trim().length > 0) {
          depReason = fromTaskReason.trim();
        }
      }

      const isDataflowJustified = depReason !== undefined;
      const writeScopeDisjoint = !overlap.hasOverlap;
      const stallDuration = extractEffort(blocker);

      let recommendation: string;
      if (writeScopeDisjoint && !isDataflowJustified) {
        recommendation =
          `Eliminate sequential dependency: Task ${task.id} is blocked by ${blockerId} for ${stallDuration} units ` +
          `despite disjoint write scopes and no declared dataflow reason. Decouple to unlock parallel lane.`;
      } else if (writeScopeDisjoint && isDataflowJustified) {
        recommendation =
          `Disjoint write scopes with validated dataflow justification: "${depReason}". Dependency is legitimate.`;
      } else {
        const conflict = overlap.conflictingPath.length > 0 ? overlap.conflictingPath : "overlapping scope";
        recommendation =
          `Physical write scope overlap: tasks contend on [${conflict}]. Sequential ordering is required.`;
      }

      stalls.push({
        blockedTaskId: task.id,
        blockerTaskId: blockerId,
        stallDuration,
        writeScopeDisjoint,
        isDataflowJustified,
        depReason,
        isCriticalStall: writeScopeDisjoint && !isDataflowJustified,
        recommendation,
      });
    }
  }

  return stalls;
}

/**
 * Computes Work ($W$), Span ($S$), Parallelism ($P = W / S$), Critical Path, Brent's Bounds,
 * Critical Path Drag, Fan-Out Bottlenecks, and Queue Stalls.
 */
export function computeWorkSpan(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  maxLanes = 40,
): WorkSpanMetrics {
  let totalWork = 0;
  for (const task of tasks) {
    totalWork += extractEffort(task);
  }

  const { criticalSpan, criticalPath } = internalComputeSpan(tasks, dependencies);

  const parallelismFactor =
    criticalSpan > 0 ? Math.round((totalWork / criticalSpan) * 100) / 100 : tasks.length > 0 ? 1 : 0;

  const optimalLanes = Math.max(1, Math.min(maxLanes, Math.ceil(parallelismFactor > 0 ? parallelismFactor : 1)));

  const standardProcessors = [1, 2, 4, 8, 16, maxLanes].filter((v, i, a) => a.indexOf(v) === i && v <= maxLanes);
  const brentsBounds = standardProcessors.map((p) => calculateBrentsTheorem(totalWork, criticalSpan, p));

  const drags = computeCriticalPathDrag(tasks, dependencies);
  const fanOutBottlenecks = detectFanOutBottlenecks(tasks, dependencies);
  const queueStalls = analyzeQueueStalls(tasks);

  return {
    totalWork,
    criticalSpan,
    parallelismFactor,
    optimalLanes,
    maxSupportedLanes: maxLanes,
    criticalPath,
    brentsBounds,
    drags,
    fanOutBottlenecks,
    queueStalls,
  };
}

/**
 * Computes Earliest Start Time (EST), Earliest Finish Time (EFT),
 * Latest Start Time (LST), Latest Finish Time (LFT), Total Slack, and Free Slack for each task.
 * Critical path tasks have Total Slack = 0.
 */
export function computeTaskSlack(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, TaskSlack> {
  const effortMap = new Map<string, number>();
  for (const t of tasks) {
    effortMap.set(t.id, extractEffort(t));
  }

  const order = topologicalOrder(dependencies);
  const estMap = new Map<string, number>();
  const eftMap = new Map<string, number>();

  // Forward pass: calculate EST and EFT
  for (const id of order) {
    const effort = extractEffortById(effortMap, id);
    const prereqs = extractNeighbors(dependencies, id);
    let maxEft = 0;
    for (const p of prereqs) {
      const pEft = eftMap.get(p);
      const val = typeof pEft === "number" ? pEft : 0;
      if (val > maxEft) maxEft = val;
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
  const reversedOrder = Array.from(order).reverse();
  for (const id of reversedOrder) {
    const effort = extractEffortById(effortMap, id);
    const childrenSet = downstream.get(id);
    const children: string[] = [];
    if (childrenSet !== undefined) {
      for (const c of childrenSet) {
        children.push(c);
      }
    }

    let minLst = totalSpan;
    for (const c of children) {
      const cLst = lstMap.get(c);
      const val = typeof cLst === "number" ? cLst : totalSpan;
      if (val < minLst) minLst = val;
    }
    lftMap.set(id, minLst);
    lstMap.set(id, minLst - effort);
  }

  const result = new Map<string, TaskSlack>();
  for (const t of tasks) {
    const effort = extractEffortById(effortMap, t.id);
    const rawEst = estMap.get(t.id);
    const est = typeof rawEst === "number" ? rawEst : 0;

    const rawEft = eftMap.get(t.id);
    const eft = typeof rawEft === "number" ? rawEft : effort;

    const rawLft = lftMap.get(t.id);
    const lft = typeof rawLft === "number" ? rawLft : totalSpan;

    const rawLst = lstMap.get(t.id);
    const lst = typeof rawLst === "number" ? rawLst : totalSpan - effort;

    const totalSlack = Math.max(0, lst - est);

    // Free slack: min(EST of children) - EFT (or totalSpan - EFT if no children)
    const childrenSet = downstream.get(t.id);
    let minChildEst = totalSpan;
    if (childrenSet !== undefined && childrenSet.size > 0) {
      for (const childId of childrenSet) {
        const childEst = estMap.get(childId);
        const val = typeof childEst === "number" ? childEst : totalSpan;
        if (val < minChildEst) {
          minChildEst = val;
        }
      }
    }
    const freeSlack = Math.max(0, minChildEst - eft);
    const isCritical = totalSlack === 0;

    result.set(t.id, {
      taskId: t.id,
      effort,
      earliestStartTime: est,
      earliestFinishTime: eft,
      latestStartTime: lst,
      latestFinishTime: lft,
      totalSlack,
      freeSlack,
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
  const taskMap = new Map<string, ForensicTaskNode>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const waveMap = new Map<string, number>();
  let currentWave = 1;
  const processed = new Set<string>();

  while (processed.size < tasks.length) {
    const readyInThisWave: string[] = [];
    for (const t of tasks) {
      if (processed.has(t.id)) continue;
      const prereqs = extractNeighbors(dependencies, t.id);
      const allPrereqsDone = prereqs.every((p) => waveMap.has(p));
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
    currentWave += 1;
  }

  const maxWave = Math.max(1, currentWave - 1);
  const waves: ForensicWave[] = [];

  for (let w = 1; w <= maxWave; w++) {
    const waveTasks = tasks.filter((t) => waveMap.get(t.id) === w);
    if (waveTasks.length === 0) continue;

    const taskIds = waveTasks.map((t) => t.id);
    let totalWaveEffort = 0;
    for (const t of waveTasks) {
      totalWaveEffort += extractEffort(t);
    }

    let hasConflicts = false;
    for (let i = 0; i < waveTasks.length; i++) {
      const taskA = waveTasks[i];
      if (taskA === undefined) continue;
      for (let j = i + 1; j < waveTasks.length; j++) {
        const taskB = waveTasks[j];
        if (taskB === undefined) continue;
        const scopesA = taskA.writeScope !== undefined ? taskA.writeScope : [];
        const scopesB = taskB.writeScope !== undefined ? taskB.writeScope : [];
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
        earliestStartTime: slack !== undefined ? slack.earliestStartTime : undefined,
        earliestFinishTime: slack !== undefined ? slack.earliestFinishTime : undefined,
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
  const normalizedTasks = tasks.map((t) => {
    const rawScopes = t.writeScope !== undefined ? t.writeScope : [];
    const rawDeps = t.dependencies !== undefined ? t.dependencies : [];
    const rawReasons = t.depReasons !== undefined ? t.depReasons : {};
    return {
      taskId: t.id,
      writeScope: rawScopes.map(normalizeScopePath),
      dependencies: rawDeps.filter(isNonblank),
      depReasons: rawReasons,
    };
  });

  const warnings: ArtificialSerializationWarning[] = [];
  for (const task of normalizedTasks) {
    for (const depId of task.dependencies) {
      const depTask = normalizedTasks.find((t) => t.taskId === depId);
      if (depTask === undefined) continue;

      const overlap = checkScopeOverlap(task.writeScope, depTask.writeScope);
      const edgeKey = `${task.taskId}->${depTask.taskId}`;
      let justification: string | undefined = justificationsByEdge.get(edgeKey);
      if (justification === undefined && depId in task.depReasons) {
        justification = task.depReasons[depId];
      }
      const hasJustification = typeof justification === "string" && justification.trim().length > 0;

      if (!overlap.hasOverlap) {
        const justificationSuffix = hasJustification
          ? ` despite declared justification: ${justification}`
          : " and no dataflow justification.";

        warnings.push({
          code: "ARTIFICIAL_SERIALIZATION_WARNING",
          blockedTask: task.taskId,
          dependencyTask: depTask.taskId,
          message:
            `Task ${task.taskId} is artificially serialized behind ${depTask.taskId} with disjoint write scopes ` +
            `([${task.writeScope.join(", ")}] vs [${depTask.writeScope.join(", ")}])` +
            justificationSuffix,
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
    const label = task.label !== undefined && task.label.length > 0
      ? `${task.id}["${task.id}: ${task.label}"]`
      : task.id;
    lines.push(`  ${label}`);
  }

  for (const [taskId, prereqs] of dependencies) {
    for (const prereq of prereqs) {
      lines.push(`  ${prereq} --> ${taskId}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generates an ASCII/Unicode diagnostic forensics report string for console or artifact output.
 */
export function renderForensicUnicodeReport(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const metrics = computeWorkSpan(tasks, dependencies);
  const slackMap = computeTaskSlack(tasks, dependencies);
  const waves = computeTopologicalWaves(tasks, dependencies);

  const lines: string[] = [
    "╔════════════════════════════════════════════════════════════════════════════════╗",
    "║                       DAG FORENSICS & WORK/SPAN REPORT                         ║",
    "╠════════════════════════════════════════════════════════════════════════════════╣",
    `║ Total Work (W): ${String(metrics.totalWork).padEnd(6)} | Critical Span (S): ${String(metrics.criticalSpan).padEnd(6)} | Concurrency (P): ${String(metrics.parallelismFactor).padEnd(6)} ║`,
    `║ Optimal Lanes:  ${String(metrics.optimalLanes).padEnd(6)} | Total Waves:       ${String(waves.length).padEnd(6)} | Total Tasks:     ${String(tasks.length).padEnd(6)} ║`,
    "╠════════════════════════════════════════════════════════════════════════════════╣",
    `║ Critical Path: [${metrics.criticalPath.join(" -> ")}]`,
    "╠════════════════════════════════════════════════════════════════════════════════╣",
    "║ TASK SLACK & CRITICAL PATH DRAG:                                              ║",
  ];

  for (const task of tasks) {
    const slack = slackMap.get(task.id);
    const est = slack !== undefined ? slack.earliestStartTime : 0;
    const eft = slack !== undefined ? slack.earliestFinishTime : 0;
    const lst = slack !== undefined ? slack.latestStartTime : 0;
    const lft = slack !== undefined ? slack.latestFinishTime : 0;
    const totSlack = slack !== undefined ? slack.totalSlack : 0;
    const isCrit = slack !== undefined ? slack.isCritical : false;

    const dragInfo = metrics.drags.find((d) => d.taskId === task.id);
    const drag = dragInfo !== undefined ? dragInfo.drag : 0;

    const critMark = isCrit ? "[CRITICAL]" : "[SLACK]   ";
    lines.push(
      `║ ${critMark} ${task.id.padEnd(24)} EST:${String(est).padStart(2)} EFT:${String(eft).padStart(2)} LST:${String(lst).padStart(2)} LFT:${String(lft).padStart(2)} Slack:${String(totSlack).padStart(2)} Drag:${String(drag).padStart(2)} ║`,
    );
  }

  if (metrics.fanOutBottlenecks.length > 0) {
    lines.push("╠════════════════════════════════════════════════════════════════════════════════╣");
    lines.push("║ FAN-OUT BOTTLENECKS:                                                           ║");
    for (const b of metrics.fanOutBottlenecks) {
      lines.push(
        `║ ⚠️  Task ${b.taskId} (fan-out: ${b.fanOutCount}, blocked effort: ${b.blockedEffort}, severity: ${b.severity})`,
      );
    }
  }

  if (metrics.queueStalls.length > 0) {
    const artificial = metrics.queueStalls.filter((s) => s.isCriticalStall);
    if (artificial.length > 0) {
      lines.push("╠════════════════════════════════════════════════════════════════════════════════╣");
      lines.push("║ ARTIFICIAL SERIALIZATION & QUEUE STALLS:                                       ║");
      for (const s of artificial) {
        lines.push(`║ 🛑 ${s.blockedTaskId} stalled by ${s.blockerTaskId} (${s.stallDuration} units): ${s.recommendation}`);
      }
    }
  }

  lines.push("╚════════════════════════════════════════════════════════════════════════════════╝");
  return lines.join("\n");
}

export {
  topologicalOrder,
  downstreamMap,
  type DependencyMap,
} from "./topology.ts";
