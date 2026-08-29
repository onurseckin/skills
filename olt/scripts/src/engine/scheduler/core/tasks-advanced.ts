import type { ScopeCollisionProbeResult, ScopeCollisionHazard, WorkSpanHealthAudit } from "./types.ts";
import { computeWorkSpanMetrics } from "../topology/dynamic-metrics.ts";
import { dependencyMap } from "../../../graph/dependency-map";
import { isRecord } from "../../store/layout/layout-json.ts";
import { scopeConflict, resourceConflict } from "../conflict/conflicts";
import { ScheduledTask } from "../conflict/rank";

export const NOOP_COMMANDS = new Set([":", "echo", "exit", "false", "printf", "true"]);
export function probeScopeCollisionHazards(state: unknown): ScopeCollisionProbeResult {
  const activeCollisions: ScopeCollisionHazard[] = [];
  const candidateCollisions: ScopeCollisionHazard[] = [];
  const details: string[] = [];

  if (!isRecord(state) || !isRecord(state.tasks)) {
    return {
      passed: true,
      activeCollisions: [],
      candidateCollisions: [],
      totalHazardCount: 0,
      details: [],
    };
  }

  interface TaskScopeEntry {
    readonly id: string;
    readonly status: string;
    readonly writeScope: string[];
    readonly resourceScope: string[];
  }

  const taskEntries: TaskScopeEntry[] = [];
  for (const [taskId, rawTask] of Object.entries(state.tasks)) {
    if (!isRecord(rawTask)) continue;
    taskEntries.push({
      id: taskId,
      status: typeof rawTask.status === "string" ? rawTask.status : "unknown",
      writeScope: Array.isArray(rawTask.write_scope) ? (rawTask.write_scope as string[]) : [],
      resourceScope: Array.isArray(rawTask.resource_scope)
        ? (rawTask.resource_scope as string[])
        : [],
    });
  }

  const activeStatuses = new Set(["leased", "running", "validating"]);
  const candidateStatuses = new Set(["proposed", "ready", "retry_ready"]);

  for (let i = 0; i < taskEntries.length; i++) {
    for (let j = i + 1; j < taskEntries.length; j++) {
      const left = taskEntries[i]!;
      const right = taskEntries[j]!;

      const writeConflict = scopeConflict(left.writeScope, right.writeScope);
      const resConflict = resourceConflict(left.resourceScope, right.resourceScope);

      if (writeConflict || resConflict) {
        const conflictType =
          writeConflict && resConflict ? "both" : writeConflict ? "write_scope" : "resource_scope";
        const hazard: ScopeCollisionHazard = {
          leftTaskId: left.id,
          rightTaskId: right.id,
          conflictType,
          writeScopeOverlap: writeConflict,
          resourceScopeOverlap: resConflict,
          details: `Tasks '${left.id}' (${left.status}) and '${right.id}' (${right.status}) collide on ${conflictType}: [${left.writeScope.join(", ")}] vs [${right.writeScope.join(", ")}]`,
        };

        if (activeStatuses.has(left.status) && activeStatuses.has(right.status)) {
          activeCollisions.push(hazard);
          details.push(`Active concurrent collision: ${hazard.details}`);
        } else if (candidateStatuses.has(left.status) && candidateStatuses.has(right.status)) {
          candidateCollisions.push(hazard);
        }
      }
    }
  }

  const totalHazardCount = activeCollisions.length + candidateCollisions.length;
  const passed = activeCollisions.length === 0;

  return {
    passed,
    activeCollisions,
    candidateCollisions,
    totalHazardCount,
    details,
  };
}
export function probeWorkSpanParallelizationHealth(state: unknown): WorkSpanHealthAudit {
  const details: string[] = [];
  const activeBottlenecks: string[] = [];

  if (!isRecord(state) || !isRecord(state.tasks)) {
    return {
      passed: true,
      workParallelismRatio: 1,
      totalTasks: 0,
      completedTasks: 0,
      activeTasks: 0,
      readyTasks: 0,
      criticalPathLength: 0,
      activeBottlenecks: [],
      dynamicTopologyWaveCount: 0,
      spanUtilizationRatio: 1,
      details: ["State has no tasks to evaluate."],
    };
  }

  const tasks = Object.values(state.tasks).filter(isRecord);
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(
    (t) => t.status === "done" || t.status === "validated",
  ).length;
  const activeTasks = tasks.filter(
    (t) => t.status === "running" || t.status === "leased" || t.status === "validating",
  ).length;
  const readyTasks = tasks.filter((t) => t.status === "ready" || t.status === "retry_ready").length;

  let criticalPathLength = 1;
  let dynamicTopologyWaveCount = 1;
  let workParallelismRatio =
    totalTasks > 0 ? (totalTasks - completedTasks) / Math.max(1, criticalPathLength) : 1;
  let spanUtilizationRatio = 1;

  if (isRecord(state.graph)) {
    try {
      const depMap = dependencyMap(state.graph);
      const scheduledTasks = new Map<string, ScheduledTask>();
      if (isRecord(state.tasks)) {
        for (const [id, t] of Object.entries(state.tasks)) {
          if (isRecord(t)) {
            scheduledTasks.set(id, {
              id,
              priority: typeof t.priority === "number" ? t.priority : 0,
              created_order: typeof t.created_order === "number" ? t.created_order : 0,
              effort: typeof t.effort === "number" ? t.effort : 1,
              requirement_ids: Array.isArray(t.requirement_ids)
                ? (t.requirement_ids as string[])
                : [],
              resource_scope: Array.isArray(t.resource_scope) ? (t.resource_scope as string[]) : [],
              write_scope: Array.isArray(t.write_scope) ? (t.write_scope as string[]) : [],
            });
          }
        }
      }
      const metrics = computeWorkSpanMetrics(depMap, scheduledTasks);
      criticalPathLength = Math.max(1, metrics.criticalPath.length);
      workParallelismRatio = metrics.parallelismFactor;
      spanUtilizationRatio =
        metrics.span > 0 ? Number((metrics.work / metrics.span).toFixed(2)) : 1;
      dynamicTopologyWaveCount = metrics.minWaves;
      if (metrics.parallelismFactor < 1.0 && totalTasks > 3 && completedTasks < totalTasks) {
        activeBottlenecks.push(
          `Critical path length (${metrics.criticalPath.length}) restricts parallelism ratio to ${metrics.parallelismFactor.toFixed(2)}.`,
        );
      }
    } catch {
      // Fallback
    }
  }

  // Check write scope collisions as active bottlenecks
  const scopeProbe = probeScopeCollisionHazards(state);
  if (scopeProbe.activeCollisions.length > 0) {
    for (const col of scopeProbe.activeCollisions) {
      activeBottlenecks.push(`Write scope bottleneck: ${col.details}`);
    }
  }

  const passed = activeBottlenecks.length === 0;
  if (passed) {
    details.push(
      `Work/Span parallelization is healthy: parallelism ratio ${workParallelismRatio.toFixed(2)}, span utilization ${(spanUtilizationRatio * 100).toFixed(0)}%.`,
    );
  } else {
    details.push(...activeBottlenecks);
  }

  return {
    passed,
    workParallelismRatio: Number(workParallelismRatio.toFixed(2)),
    totalTasks,
    completedTasks,
    activeTasks,
    readyTasks,
    criticalPathLength,
    activeBottlenecks,
    dynamicTopologyWaveCount,
    spanUtilizationRatio: Number(spanUtilizationRatio.toFixed(2)),
    details,
  };
}
