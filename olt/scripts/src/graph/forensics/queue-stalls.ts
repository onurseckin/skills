import { isNonblank } from "../../requirements/predicates.ts";
import { checkScopeOverlap, normalizeScopePath } from "../scope-analyzer.ts";
import { extractEffort } from "./critical-path.ts";
import type {
  ArtificialSerializationWarning,
  ForensicTaskNode,
  QueueStallAnalysis,
} from "./types.ts";

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

    const taskScopes = (task.writeScope !== undefined ? task.writeScope : []).map(
      normalizeScopePath,
    );

    for (const blockerId of deps) {
      const blocker = taskMap.get(blockerId);
      if (blocker === undefined) continue;

      const blockerScopes = (blocker.writeScope !== undefined ? blocker.writeScope : []).map(
        normalizeScopePath,
      );
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
        recommendation = `Disjoint write scopes with validated dataflow justification: "${depReason}". Dependency is legitimate.`;
      } else {
        const conflict =
          overlap.conflictingPath.length > 0 ? overlap.conflictingPath : "overlapping scope";
        recommendation = `Physical write scope overlap: tasks contend on [${conflict}]. Sequential ordering is required.`;
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
