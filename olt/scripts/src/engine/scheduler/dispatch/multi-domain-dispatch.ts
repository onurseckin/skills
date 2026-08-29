import { dependencyMap } from "../../../graph/dependency-map.ts";
import { isRecord } from "../../../requirements/predicates.ts";
import { hasActiveOwnership } from "../conflict/conflicts.ts";
import {
  MULTI_DOMAIN_PARALLELISM_THRESHOLD,
  type TaskDomain,
  type MultiDomainTaskDispatch,
  type MultiDomainBatchOptions,
  type MultiDomainBatchResult,
  type MultiDomainValidatorDispatchOptions,
  type MultiDomainValidatorDispatchResult,
  type MultiDomainBlockedTaskInfo,
  type MultiDomainWaveOptions,
  type MultiDomainWaveResult,
  DISPATCHABLE_STATUSES,
  isMultiDomainDispatchEligible,
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  isDualValidationRequired,
  getRequiredValidatorDomains,
} from "./multi-domain-types.ts";
import { dispatchMultiDomainValidators as dispatchValidatorsInternal } from "./multi-domain-validators.ts";
import { resolveParallelismFactor, evaluateMultiDomainBatch } from "./multi-domain-batch.ts";

export {
  MULTI_DOMAIN_PARALLELISM_THRESHOLD,
  type TaskDomain,
  type MultiDomainTaskDispatch,
  type MultiDomainBatchOptions,
  type MultiDomainBatchResult,
  type MultiDomainValidatorDispatchOptions,
  type MultiDomainValidatorDispatchResult,
  type MultiDomainBlockedTaskInfo,
  type MultiDomainWaveOptions,
  type MultiDomainWaveResult,
  isMultiDomainDispatchEligible,
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  isDualValidationRequired,
  getRequiredValidatorDomains,
  resolveParallelismFactor,
  evaluateMultiDomainBatch,
};

export function dispatchMultiDomainValidators(
  state: unknown,
  options: MultiDomainValidatorDispatchOptions = {},
): MultiDomainValidatorDispatchResult {
  return dispatchValidatorsInternal(state, options, resolveParallelismFactor);
}

export function proposeMultiDomainWave(
  state: unknown,
  options: MultiDomainWaveOptions = {},
): MultiDomainWaveResult {
  const batchResult = evaluateMultiDomainBatch(state, options);
  const now = options.clock?.now() ?? new Date();

  const activeOccupiedTasks: string[] = [];
  const blockedTasks: MultiDomainBlockedTaskInfo[] = [];

  if (isRecord(state) && isRecord(state.tasks)) {
    const deps = isRecord(state.graph)
      ? dependencyMap(state.graph)
      : new Map<string, Set<string>>();
    const doneSet = new Set<string>();

    for (const [id, rawTask] of Object.entries(state.tasks)) {
      if (isRecord(rawTask) && (rawTask.status === "done" || rawTask.status === "validated")) {
        doneSet.add(id);
      }
    }

    for (const [taskId, rawTask] of Object.entries(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      const status = String(rawTask.status);
      if (hasActiveOwnership(status) && !DISPATCHABLE_STATUSES.has(status)) {
        activeOccupiedTasks.push(taskId);
      } else if (
        status === "blocked" ||
        status === "changes_requested" ||
        status === "stale" ||
        status === "escalated"
      ) {
        const prerequisites = Array.from(deps.get(taskId) ?? []);
        const unsatisfied = prerequisites.filter((p) => !doneSet.has(p));
        blockedTasks.push({
          taskId,
          status,
          blockingReason: `Task in status '${status}' is blocked from multi-domain dispatch.`,
          prerequisites,
          unsatisfiedPrerequisites: unsatisfied,
        });
      }
    }
  }

  return {
    ...batchResult,
    wave: 1,
    evaluatedAt: now.toISOString(),
    blockedTasks,
    activeOccupiedTasks,
  };
}
