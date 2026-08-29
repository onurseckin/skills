import { HarnessError } from "../../../core/errors/index.ts";
import { dependencyMap } from "../../../graph/dependency-map.ts";
import { isInteger, isRecord } from "../../../requirements/predicates.ts";
import { hasActiveOwnership, resourceConflict, scopeConflict } from "../conflict/conflicts.ts";
import { schedulingMetrics } from "../topology/metrics.ts";
import { rankTasks, type ScheduledTask } from "../conflict/rank.ts";
import {
  DISPATCHABLE_STATUSES,
  isMultiDomainDispatchEligible,
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  normalizeTask,
  type MultiDomainTaskDispatch,
  type MultiDomainValidatorDispatchOptions,
  type MultiDomainValidatorDispatchResult,
} from "./multi-domain-types.ts";

export function conflicts(
  left: { write_scope: readonly string[]; resource_scope?: readonly string[] },
  right: { write_scope: readonly string[]; resource_scope?: readonly string[] },
): boolean {
  return (
    scopeConflict(left.write_scope, right.write_scope) ||
    resourceConflict(left.resource_scope ?? [], right.resource_scope ?? [])
  );
}

export function occupiesScope(task: ScheduledTask): boolean {
  const status = String(task.status);
  return hasActiveOwnership(status) && !DISPATCHABLE_STATUSES.has(status) && status !== "submitted";
}

export function dispatchMultiDomainValidators(
  state: unknown,
  options: MultiDomainValidatorDispatchOptions = {},
  resolveParallelismFactorFn: (state: unknown, explicit?: number) => number,
): MultiDomainValidatorDispatchResult {
  const maxParallel =
    options.maxParallel !== undefined && options.maxParallel !== null ? options.maxParallel : 10;

  if (!isInteger(maxParallel) || maxParallel < 1) {
    throw new HarnessError("INVALID_ARGUMENT", "maxParallel must be a positive integer");
  }

  if (!isRecord(state) || !isRecord(state.tasks)) {
    throw new HarnessError("INVALID_STATE", "tasks must be present to evaluate validator dispatch");
  }

  const pFactor = resolveParallelismFactorFn(state, options.parallelismFactor);
  const isMultiDomainActive = isMultiDomainDispatchEligible(pFactor);

  const allTasks = new Map<string, ScheduledTask>();
  for (const [id, value] of Object.entries(state.tasks)) {
    const norm = normalizeTask(id, value);
    if (norm) allTasks.set(id, norm);
  }

  const occupiedTasks = [...allTasks.values()].filter(occupiesScope);
  const activeImplementerScopes = options.activeImplementerScopes ?? [];
  const activeResourceScopes = options.activeResourceScopes ?? [];

  const submittedTasks = [...allTasks.values()].filter((task) => task.status === "submitted");

  const eligibleValidators = submittedTasks.filter((task) => {
    if (occupiedTasks.some((running) => running.id !== task.id && conflicts(task, running))) {
      return false;
    }
    for (const implScope of activeImplementerScopes) {
      if (scopeConflict(task.write_scope, implScope)) return false;
    }
    for (const resScope of activeResourceScopes) {
      if (resourceConflict(task.resource_scope ?? [], resScope)) return false;
    }
    return true;
  });

  const dependencies = isRecord(state.graph)
    ? dependencyMap(state.graph)
    : new Map<string, Set<string>>();
  const metrics = schedulingMetrics(dependencies);
  const rankedValidators = rankTasks(eligibleValidators, metrics);

  const selectedValidators: ScheduledTask[] = [];

  if (!isMultiDomainActive) {
    for (const candidate of rankedValidators) {
      if (selectedValidators.some((chosen) => conflicts(candidate, chosen))) continue;
      selectedValidators.push(candidate);
      if (selectedValidators.length >= maxParallel) break;
    }
  } else {
    const domainGroups = new Map<string, ScheduledTask[]>();
    for (const task of rankedValidators) {
      const domain = classifyTaskDomain(task);
      const group = domainGroups.get(domain) ?? [];
      group.push(task);
      domainGroups.set(domain, group);
    }

    const sortedDomains = Array.from(domainGroups.keys()).sort();
    let madeProgress = true;
    while (madeProgress && selectedValidators.length < maxParallel) {
      madeProgress = false;
      for (const domain of sortedDomains) {
        if (selectedValidators.length >= maxParallel) break;
        const group = domainGroups.get(domain) ?? [];
        let candidateIndex = -1;
        for (let i = 0; i < group.length; i++) {
          const candidate = group[i]!;
          if (!selectedValidators.some((chosen) => conflicts(candidate, chosen))) {
            candidateIndex = i;
            break;
          }
        }
        if (candidateIndex >= 0) {
          const [chosen] = group.splice(candidateIndex, 1);
          if (chosen) {
            selectedValidators.push(chosen);
            madeProgress = true;
          }
        }
      }
    }
  }

  const validatorDispatches: MultiDomainTaskDispatch[] = selectedValidators.map((t) => ({
    taskId: t.id,
    domain: classifyTaskDomain(t),
    role: "validator" as const,
    validatorDomain: derivePrimaryValidatorDomain(t),
    priority: t.priority,
    writeScope: [...t.write_scope],
    resourceScope: [...(t.resource_scope ?? [])],
    requirementIds: [...t.requirement_ids],
    status: String(t.status),
  }));

  const dispatchedDomains = Array.from(new Set(validatorDispatches.map((d) => d.domain))).sort();

  let scopeIsolated = true;
  for (let i = 0; i < validatorDispatches.length; i++) {
    const a = validatorDispatches[i]!;
    for (let j = i + 1; j < validatorDispatches.length; j++) {
      const b = validatorDispatches[j]!;
      if (
        scopeConflict(a.writeScope, b.writeScope) ||
        resourceConflict(a.resourceScope, b.resourceScope)
      ) {
        scopeIsolated = false;
        break;
      }
    }
    if (!scopeIsolated) break;
  }

  return {
    parallelismFactor: pFactor,
    isMultiDomainActive,
    validatorDispatches,
    dispatchedDomains,
    eligibleSubmittedTasks: submittedTasks.length,
    scopeIsolated,
  };
}
