import {
  assertAntiBatchingRule,
  evaluateHierarchyScaling,
  planWaveExecution,
  detectScopeOverlap,
  updateCognitiveMemory,
  computeMacroMetrics,
} from "../planner/index.ts";
import { HarnessError } from "../../../../core/errors/index.ts";
import type {
  SmartTaskPlan,
  MultiOrchestratorPrePlanningResult,
  MultiOrchestratorPlanningOptions,
  MultiOrchestratorSubTreePlan,
  ScopeCollision,
} from "../planner/models.ts";
import type { MacroMetrics, CognitiveMemoryState } from "../planner/types.ts";
export function preplanMultiOrchestratorTasks(
  tasks: readonly SmartTaskPlan[],
  options: MultiOrchestratorPlanningOptions | number | readonly string[] = {},
): MultiOrchestratorPrePlanningResult {
  let targetOrchestratorIds: string[] = [];
  let maxOrchestrators = 2;
  let autoUpdateMemory = false;
  let cognitiveMemoryPath: string | undefined = undefined;

  if (typeof options === "number") {
    maxOrchestrators = Math.max(1, options);
    targetOrchestratorIds = Array.from(
      { length: maxOrchestrators },
      (_, i) => `orchestrator-${i + 1}`,
    );
  } else if (Array.isArray(options)) {
    targetOrchestratorIds = options.length > 0 ? [...options] : ["orchestrator-1"];
    maxOrchestrators = targetOrchestratorIds.length;
  } else {
    const opts = options as MultiOrchestratorPlanningOptions;
    if (opts.orchestratorIds && opts.orchestratorIds.length > 0) {
      targetOrchestratorIds = [...opts.orchestratorIds];
      maxOrchestrators = targetOrchestratorIds.length;
    } else if (typeof opts.maxOrchestrators === "number" && opts.maxOrchestrators > 0) {
      maxOrchestrators = opts.maxOrchestrators;
      targetOrchestratorIds = Array.from(
        { length: maxOrchestrators },
        (_, i) => `orchestrator-${i + 1}`,
      );
    } else {
      maxOrchestrators = Math.max(1, Math.min(tasks.length > 0 ? tasks.length : 1, 4));
      targetOrchestratorIds = Array.from(
        { length: maxOrchestrators },
        (_, i) => `orchestrator-${i + 1}`,
      );
    }
    autoUpdateMemory = opts.autoUpdateMemory ?? false;
    cognitiveMemoryPath = opts.cognitiveMemoryPath;
  }

  if (tasks.length === 0) {
    const emptyMetrics: MacroMetrics = { work: 0, span: 0, parallelism: 0, efficiency: 0 };
    return {
      total_orchestrators: 0,
      total_tasks: 0,
      orchestrators: [],
      macro_metrics: emptyMetrics,
      is_disjoint: true,
      cross_orchestrator_collisions: [],
      warnings: [],
    };
  }

  // 1. Group tasks into connected clusters based on scope overlap and dependencies
  const n = tasks.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    let root = i;
    while (root !== parent[root]) {
      root = parent[root]!;
    }
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr]!;
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  }
  function union(i: number, j: number): void {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
    }
  }

  const taskIdToIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    taskIdToIndex.set(tasks[i]!.id, i);
  }

  for (let i = 0; i < n; i++) {
    const taskA = tasks[i]!;
    for (const depId of taskA.dependencies) {
      const depIdx = taskIdToIndex.get(depId);
      if (depIdx !== undefined) {
        union(i, depIdx);
      }
    }
    for (let j = i + 1; j < n; j++) {
      const taskB = tasks[j]!;
      if (detectScopeOverlap(taskA.write_scope, taskB.write_scope).length > 0) {
        union(i, j);
      }
    }
  }

  const clusterMap = new Map<number, SmartTaskPlan[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = clusterMap.get(root) ?? [];
    list.push(tasks[i]!);
    clusterMap.set(root, list);
  }

  interface TaskCluster {
    readonly tasks: readonly SmartTaskPlan[];
    readonly totalWork: number;
    readonly scopes: readonly string[];
  }

  const clusters: TaskCluster[] = [];
  for (const clusterTasks of clusterMap.values()) {
    let work = 0;
    const scopeSet = new Set<string>();
    for (const t of clusterTasks) {
      work += typeof t.effort === "number" && t.effort > 0 ? t.effort : 1;
      for (const s of t.write_scope) {
        scopeSet.add(s);
      }
    }
    clusters.push({
      tasks: clusterTasks,
      totalWork: work,
      scopes: Array.from(scopeSet),
    });
  }

  clusters.sort((a, b) => b.totalWork - a.totalWork);

  // 2. Bin pack clusters across target orchestrators
  const numOrchestrators = Math.min(clusters.length, targetOrchestratorIds.length);
  const activeOrchIds = targetOrchestratorIds.slice(0, Math.max(1, numOrchestrators));

  interface OrchBucket {
    readonly id: string;
    tasks: SmartTaskPlan[];
    totalWork: number;
    scopes: Set<string>;
  }

  const buckets: OrchBucket[] = activeOrchIds.map((id) => ({
    id,
    tasks: [],
    totalWork: 0,
    scopes: new Set<string>(),
  }));

  for (const cluster of clusters) {
    let chosenBucket = buckets[0]!;
    for (let b = 1; b < buckets.length; b++) {
      if (buckets[b]!.totalWork < chosenBucket.totalWork) {
        chosenBucket = buckets[b]!;
      }
    }

    for (const t of cluster.tasks) {
      chosenBucket.tasks.push(t);
    }
    chosenBucket.totalWork += cluster.totalWork;
    for (const s of cluster.scopes) {
      chosenBucket.scopes.add(s);
    }
  }

  // 3. Build sub-tree plans for each active orchestrator
  const subTreePlans: MultiOrchestratorSubTreePlan[] = [];
  const crossCollisions: ScopeCollision[] = [];
  const warnings: string[] = [];

  for (const bucket of buckets) {
    if (bucket.tasks.length === 0) continue;
    const wavePlan = planWaveExecution(bucket.tasks);
    const orchScopes = Array.from(bucket.scopes);
    subTreePlans.push({
      orchestrator_id: bucket.id,
      write_scope: orchScopes,
      tasks: bucket.tasks,
      wave_plan: wavePlan,
      macro_metrics: wavePlan.macro_metrics ?? computeMacroMetrics(bucket.tasks),
    });
  }

  // 4. Verify disjointness across orchestrator sub-trees
  for (let i = 0; i < subTreePlans.length; i++) {
    for (let j = i + 1; j < subTreePlans.length; j++) {
      const orchA = subTreePlans[i]!;
      const orchB = subTreePlans[j]!;
      const overlaps = detectScopeOverlap(orchA.write_scope, orchB.write_scope);
      if (overlaps.length > 0) {
        for (const overlap of overlaps) {
          crossCollisions.push({
            scope: overlap,
            task_ids: [orchA.orchestrator_id, orchB.orchestrator_id],
          });
        }
      }
    }
  }

  // 5. Aggregate MacroMetrics
  let aggWork = 0;
  let maxSpan = 0;
  for (const st of subTreePlans) {
    aggWork += st.macro_metrics.work;
    if (st.macro_metrics.span > maxSpan) {
      maxSpan = st.macro_metrics.span;
    }
  }
  const parallelism =
    maxSpan > 0 ? Math.round((aggWork / maxSpan) * 100) / 100 : tasks.length > 0 ? 1 : 0;
  const optimalLanes = Math.max(1, Math.min(40, Math.ceil(parallelism > 0 ? parallelism : 1)));
  const efficiency =
    optimalLanes > 0 && parallelism > 0 ? Math.round((parallelism / optimalLanes) * 100) / 100 : 0;

  const aggregateMetrics: MacroMetrics = {
    work: aggWork,
    span: maxSpan,
    parallelism,
    efficiency,
  };

  if (autoUpdateMemory) {
    try {
      updateCognitiveMemory(
        (curr: CognitiveMemoryState) => ({
          ...curr,
          macro_metrics: aggregateMetrics,
        }),
        cognitiveMemoryPath,
      );
    } catch {
      // non-fatal
    }
  }
  let totalCoordinators = 0;
  for (const st of subTreePlans) {
    for (const w of st.wave_plan.waves) {
      totalCoordinators += w.coordinator_partitions?.length ?? 1;
    }
  }

  const hierarchyScaling = evaluateHierarchyScaling({
    taskCount: tasks.length,
    waveLanes: optimalLanes,
    domainCount: subTreePlans.length,
  });

  return {
    total_orchestrators: subTreePlans.length,
    total_tasks: tasks.length,
    orchestrators: subTreePlans,
    macro_metrics: aggregateMetrics,
    is_disjoint: crossCollisions.length === 0,
    cross_orchestrator_collisions: crossCollisions,
    warnings,
    hierarchy_scaling: hierarchyScaling,
    total_coordinators: Math.max(subTreePlans.length, totalCoordinators),
  };
}
