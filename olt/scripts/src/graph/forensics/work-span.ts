import { downstreamMap } from "../topology.ts";
import { checkScopeOverlap } from "../scope-analyzer.ts";
import { calculateBrentsTheorem } from "./brent-bounds.ts";
import {
  computeCriticalPathDrag,
  computeTaskSlack,
  extractEffort,
  extractNeighbors,
  internalComputeSpan,
} from "./critical-path.ts";
import { analyzeQueueStalls } from "./queue-stalls.ts";
import type {
  FanOutBottleneck,
  ForensicTaskNode,
  ForensicWave,
  ParallelLaneAssignment,
  WorkSpanMetrics,
} from "./types.ts";

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

export function computeTopologicalWaves(
  tasks: readonly ForensicTaskNode[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): ForensicWave[] {
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

export function computeWorkSpan(
  tasksOrDeps: readonly ForensicTaskNode[] | ReadonlyMap<string, ReadonlySet<string>>,
  dependenciesOrEfforts?:
    | ReadonlyMap<string, ReadonlySet<string>>
    | ReadonlyMap<string, number>
    | undefined,
  maxLanes = 40,
): WorkSpanMetrics {
  let tasks: readonly ForensicTaskNode[];
  let dependencies: ReadonlyMap<string, ReadonlySet<string>>;

  if (Array.isArray(tasksOrDeps)) {
    tasks = tasksOrDeps;
    dependencies =
      dependenciesOrEfforts instanceof Map
        ? (dependenciesOrEfforts as ReadonlyMap<string, ReadonlySet<string>>)
        : new Map<string, ReadonlySet<string>>();
  } else {
    const deps = tasksOrDeps as ReadonlyMap<string, ReadonlySet<string>>;
    dependencies = deps;
    const effortMap =
      dependenciesOrEfforts instanceof Map
        ? (dependenciesOrEfforts as ReadonlyMap<string, number>)
        : new Map<string, number>();
    const generatedTasks: ForensicTaskNode[] = [];
    for (const [id] of deps) {
      const eff = effortMap.get(id);
      generatedTasks.push({
        id,
        effort: typeof eff === "number" ? eff : 1,
      });
    }
    tasks = generatedTasks;
  }

  let totalWork = 0;
  for (const task of tasks) {
    totalWork += extractEffort(task);
  }

  const { criticalSpan, criticalPath } = internalComputeSpan(tasks, dependencies);

  const parallelismFactor =
    criticalSpan > 0
      ? Math.round((totalWork / criticalSpan) * 100) / 100
      : tasks.length > 0
        ? 1
        : 0;

  const optimalLanes = Math.max(
    1,
    Math.min(maxLanes, Math.ceil(parallelismFactor > 0 ? parallelismFactor : 1)),
  );

  const standardProcessors = [1, 2, 4, 8, 16, maxLanes].filter(
    (v, i, a) => a.indexOf(v) === i && v <= maxLanes,
  );
  const brentsBounds = standardProcessors.map((p) =>
    calculateBrentsTheorem(totalWork, criticalSpan, p),
  );

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
