import { HarnessError } from "../../core/errors/index.ts";
import { isNonblank, isRecord } from "../../requirements/predicates.ts";
import { checkScopeOverlap, normalizeScopePath, type TaskScopeInput } from "../scope-analyzer.ts";
import { formatParallelSubagentsDispatchArray } from "./hierarchy.ts";
import {
  ARTIFICIAL_SERIALIZATION_WARNING,
  FALSE_SERIALIZATION_DEFECT,
  type AntiSerializationInterlockResult,
  type ArtificialSerializationWarning,
  type DynamicLaneTaskInput,
  type SubagentDispatchItem,
} from "./types.ts";

export function detectArtificialSerialization(
  tasks: readonly TaskScopeInput[],
  justificationsByEdge: ReadonlyMap<string, string> = new Map(),
): ArtificialSerializationWarning[] {
  const normalizedTasks = tasks.map((t) => ({
    taskId: t.taskId,
    writeScope: t.writeScope.map(normalizeScopePath),
    dependencies: (t.dependencies ?? []).filter(isNonblank),
  }));

  const warnings: ArtificialSerializationWarning[] = [];
  for (const task of normalizedTasks) {
    for (const depId of task.dependencies) {
      const depTask = normalizedTasks.find((t) => t.taskId === depId);
      if (!depTask) continue;

      const overlap = checkScopeOverlap(task.writeScope, depTask.writeScope);
      const edgeKey = `${task.taskId}->${depTask.taskId}`;
      const justification = justificationsByEdge.get(edgeKey);
      const hasJustification = typeof justification === "string" && justification.trim().length > 0;

      if (!overlap.hasOverlap) {
        warnings.push({
          code: ARTIFICIAL_SERIALIZATION_WARNING,
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

export function verifyAntiSerializationInterlock(
  readyLanesOrTasks:
    | number
    | readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
  dispatchedCount?: number | undefined,
  tasks?: readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
): AntiSerializationInterlockResult {
  const isArrayInput = Array.isArray(readyLanesOrTasks);
  const targetTasks = tasks ?? (isArrayInput ? readyLanesOrTasks : []);
  const readyCount = typeof readyLanesOrTasks === "number" ? readyLanesOrTasks : targetTasks.length;

  if (dispatchedCount === undefined && isArrayInput) {
    const scopeInputs: TaskScopeInput[] = (readyLanesOrTasks as readonly unknown[]).map(
      (t, idx) => {
        let taskId = `task-${idx + 1}`;
        let writeScope: string[] = [];
        let dependencies: string[] = [];
        if (isRecord(t)) {
          if (typeof t.taskId === "string" && t.taskId.trim()) taskId = t.taskId.trim();
          else if (typeof t.id === "string" && t.id.trim()) taskId = t.id.trim();
          if (Array.isArray(t.writeScope))
            writeScope = t.writeScope.filter((s): s is string => typeof s === "string");
          else if (Array.isArray(t.write_scope))
            writeScope = t.write_scope.filter((s): s is string => typeof s === "string");
          if (Array.isArray(t.dependencies))
            dependencies = t.dependencies.filter((s): s is string => typeof s === "string");
        }
        return { taskId, writeScope, dependencies };
      },
    );

    const warnings = detectArtificialSerialization(scopeInputs);
    if (warnings.length > 0) {
      const recommended = formatParallelSubagentsDispatchArray(targetTasks);
      return {
        passed: false,
        readyLanesCount: readyCount,
        dispatchedCount: 0,
        violation: {
          code: FALSE_SERIALIZATION_DEFECT,
          message:
            warnings[0]?.message ??
            `[FALSE_SERIALIZATION_DEFECT] Artificial serialization detected.`,
          readyTaskIds: scopeInputs.map((s) => s.taskId),
          recommendedDispatchArray: recommended as SubagentDispatchItem[],
        },
      };
    }

    return {
      passed: true,
      readyLanesCount: readyCount,
      dispatchedCount: readyCount,
    };
  }

  const effectiveDispatched = typeof dispatchedCount === "number" ? dispatchedCount : readyCount;

  const readyTaskIds: string[] = targetTasks.map((t, idx) => {
    if (typeof t === "string") return t;
    if (isRecord(t)) {
      const rec = t as Record<string, unknown>;
      if (typeof rec["id"] === "string" && rec["id"].trim()) return rec["id"].trim();
      if (typeof rec["taskId"] === "string" && rec["taskId"].trim()) return rec["taskId"].trim();
    }
    return `task-${idx + 1}`;
  });

  if (readyCount >= 2 && effectiveDispatched < readyCount) {
    const recommendedDispatchArray = formatParallelSubagentsDispatchArray(targetTasks);
    const message = `[FALSE_SERIALIZATION_DEFECT] Wave contains ${readyCount} ready disjoint lanes. You MUST invoke all ${readyCount} subagents in parallel via Subagents: [...].`;

    return {
      passed: false,
      readyLanesCount: readyCount,
      dispatchedCount: effectiveDispatched,
      violation: {
        code: FALSE_SERIALIZATION_DEFECT,
        message,
        readyTaskIds,
        recommendedDispatchArray: recommendedDispatchArray as SubagentDispatchItem[],
      },
    };
  }

  return {
    passed: true,
    readyLanesCount: readyCount,
    dispatchedCount: effectiveDispatched,
  };
}

export function assertAntiSerializationInterlock(
  readyLanesOrTasks:
    | number
    | readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
  dispatchedCount?: number | undefined,
  tasks?: readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
): void {
  const result = verifyAntiSerializationInterlock(readyLanesOrTasks, dispatchedCount, tasks);
  if (!result.passed && result.violation) {
    throw new HarnessError("INVALID_STATE", result.violation.message);
  }
}
