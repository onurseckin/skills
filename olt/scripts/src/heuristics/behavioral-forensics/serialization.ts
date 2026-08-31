/**
 * @file serialization.ts
 * Behavioral heuristics for detecting false serialization and wave concurrency bottlenecks.
 */

import { createIncident } from "./incident-generator.ts";
import type { BehavioralForensicsContext, ForensicsSeverity, TaskRecord } from "./types.ts";

export interface SerializationAnalysisResult {
  readonly sequentialWaveBottlenecks: number;
  readonly disjointPairsCount: number;
}

export function evaluateSerializationHeuristics(
  ctx: BehavioralForensicsContext,
): SerializationAnalysisResult {
  const { tasks, state, addIncident } = ctx;
  let sequentialWaveBottlenecks = 0;
  let disjointPairsCount = 0;

  const taskList: TaskRecord[] = [];
  if (tasks && tasks.length > 0) {
    taskList.push(...tasks);
  } else if (
    state &&
    typeof state === "object" &&
    typeof state["tasks"] === "object" &&
    state["tasks"] !== null
  ) {
    const rawTasks = state["tasks"] as Record<string, Record<string, unknown>>;
    for (const [id, raw] of Object.entries(rawTasks)) {
      const status = typeof raw["status"] === "string" ? raw["status"] : "unknown";
      const writeScope = Array.isArray(raw["write_scope"])
        ? (raw["write_scope"] as readonly string[])
        : Array.isArray(raw["writeScope"])
          ? (raw["writeScope"] as readonly string[])
          : [];
      const dependencies = Array.isArray(raw["dependencies"])
        ? (raw["dependencies"] as readonly string[])
        : [];
      const startedAt = typeof raw["started_at"] === "number" ? raw["started_at"] : undefined;
      const completedAt = typeof raw["completed_at"] === "number" ? raw["completed_at"] : undefined;
      taskList.push({
        id,
        status,
        writeScope,
        dependencies,
        startedAt,
        completedAt,
      });
    }
  }

  const sortedTasks = [...taskList].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

  for (let i = 0; i < sortedTasks.length - 1; i++) {
    const tA = sortedTasks[i];
    const tB = sortedTasks[i + 1];
    if (tA && tB && tA.writeScope.length > 0 && tB.writeScope.length > 0) {
      const hasOverlap = tA.writeScope.some((f) => tB.writeScope.includes(f));
      const hasCausalDependency =
        tB.dependencies.includes(tA.id) || tA.dependencies.includes(tB.id);

      if (!hasOverlap && !hasCausalDependency) {
        disjointPairsCount++;
        if (
          typeof tA.completedAt === "number" &&
          typeof tB.startedAt === "number" &&
          tB.startedAt >= tA.completedAt
        ) {
          sequentialWaveBottlenecks++;
        }
      }
    }
  }

  if (sequentialWaveBottlenecks >= 2) {
    const severity: ForensicsSeverity = sequentialWaveBottlenecks >= 4 ? "CRITICAL" : "HIGH";
    addIncident(
      createIncident({
        category: "FALSE_SERIALIZATION",
        target: "wave_concurrency_bottleneck",
        title: "False Serialization: Independent Tasks Executed Serially",
        observation: `Identified ${sequentialWaveBottlenecks} instances where tasks with non-overlapping write scopes were executed in serial sequence instead of parallel waves.`,
        severity,
        metricsSnapshot: { sequentialWaveBottlenecks, disjointPairsCount },
      }),
    );
  }

  return {
    sequentialWaveBottlenecks,
    disjointPairsCount,
  };
}
