import { HarnessError } from "../../../core/errors/index.ts";
import { dependencyMap } from "../../../graph/dependency-map.ts";
import { isInteger, isRecord } from "../../../requirements/predicates.ts";
import { taskExecutionState } from "../../../workflow/authority/execution-state.ts";
import { schedulingMetrics } from "../topology/metrics.ts";
import { rankTasks, type ScheduledTask } from "../conflict/rank.ts";
import {
  type MultiDomainBatchOptions,
  type MultiDomainBatchResult,
  type MultiDomainTaskDispatch,
  DISPATCHABLE_STATUSES,
  isMultiDomainDispatchEligible,
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  normalizeTask,
} from "./multi-domain-types.ts";
import { conflicts, occupiesScope } from "./multi-domain-validators.ts";
import { resolveParallelismFactor } from "./multi-domain-factor.ts";

export { resolveParallelismFactor };

export function evaluateMultiDomainBatch(
  state: unknown,
  options: MultiDomainBatchOptions = {},
): MultiDomainBatchResult {
  const maxParallel =
    options.maxParallel !== undefined && options.maxParallel !== null ? options.maxParallel : 10;

  if (!isInteger(maxParallel) || maxParallel < 1) {
    throw new HarnessError("INVALID_ARGUMENT", "maxParallel must be a positive integer");
  }

  if (!isRecord(state) || !isRecord(state.graph) || !isRecord(state.tasks)) {
    throw new HarnessError("INVALID_STATE", "a plan must be applied before scheduling");
  }

  const pFactor = resolveParallelismFactor(state, options.parallelismFactor);
  const isMultiDomainActive = isMultiDomainDispatchEligible(pFactor);

  const dependencies = dependencyMap(state.graph);
  const allTasks = new Map<string, ScheduledTask>();
  for (const [id, value] of Object.entries(state.tasks)) {
    const norm = normalizeTask(id, value);
    if (norm) allTasks.set(id, norm);
  }

  const doneSet = new Set(
    [...allTasks.values()]
      .filter((t) => t.status === "done" || t.status === "validated")
      .map((t) => t.id),
  );

  const occupiedTasks = [...allTasks.values()].filter(occupiesScope);
  const metrics = schedulingMetrics(dependencies);

  const eligibleImplementers = [...allTasks.values()].filter((task) => {
    const status = String(task.status);
    if (!DISPATCHABLE_STATUSES.has(status)) return false;

    if (isRecord(state.requirements)) {
      const exec = taskExecutionState(state, task.requirement_ids);
      if (exec !== "executable") return false;
    }

    const prereqs = dependencies.get(task.id) ?? new Set<string>();
    for (const prereq of prereqs) {
      if (!doneSet.has(prereq)) return false;
    }

    if (occupiedTasks.some((running) => running.id !== task.id && conflicts(task, running))) {
      return false;
    }

    return true;
  });

  const rankedImplementers = rankTasks(eligibleImplementers, metrics);
  const selectedImplementers: ScheduledTask[] = [];

  if (!isMultiDomainActive) {
    for (const candidate of rankedImplementers) {
      if (selectedImplementers.some((chosen) => conflicts(candidate, chosen))) continue;
      selectedImplementers.push(candidate);
      if (selectedImplementers.length >= maxParallel) break;
    }
  } else {
    const domainGroups = new Map<string, ScheduledTask[]>();
    for (const task of rankedImplementers) {
      const domain = classifyTaskDomain(task);
      const group = domainGroups.get(domain) ?? [];
      group.push(task);
      domainGroups.set(domain, group);
    }

    const sortedDomains = Array.from(domainGroups.keys()).sort((a, b) => {
      const bestA = domainGroups.get(a)?.[0]?.priority ?? 0;
      const bestB = domainGroups.get(b)?.[0]?.priority ?? 0;
      if (bestB !== bestA) return bestB - bestA;
      return a.localeCompare(b);
    });

    let madeProgress = true;
    while (madeProgress && selectedImplementers.length < maxParallel) {
      madeProgress = false;
      for (const domain of sortedDomains) {
        if (selectedImplementers.length >= maxParallel) break;
        const group = domainGroups.get(domain) ?? [];
        let candidateIndex = -1;
        for (let i = 0; i < group.length; i++) {
          const candidate = group[i]!;
          if (!selectedImplementers.some((chosen) => conflicts(candidate, chosen))) {
            candidateIndex = i;
            break;
          }
        }
        if (candidateIndex >= 0) {
          const [chosen] = group.splice(candidateIndex, 1);
          if (chosen) {
            selectedImplementers.push(chosen);
            madeProgress = true;
          }
        }
      }
    }
  }

  const selectedValidators: ScheduledTask[] = [];
  const allowValidators =
    options.allowSimultaneousValidators !== undefined
      ? options.allowSimultaneousValidators
      : isMultiDomainActive;

  if (allowValidators) {
    const submittedTasks = [...allTasks.values()].filter((task) => task.status === "submitted");

    const eligibleValidators = submittedTasks.filter((task) => {
      if (occupiedTasks.some((running) => running.id !== task.id && conflicts(task, running))) {
        return false;
      }
      if (selectedImplementers.some((impl) => conflicts(task, impl))) return false;
      return true;
    });

    const rankedValidators = rankTasks(eligibleValidators, metrics);

    if (!isMultiDomainActive) {
      for (const val of rankedValidators) {
        if (selectedImplementers.length + selectedValidators.length >= maxParallel) break;
        if (selectedValidators.some((chosen) => conflicts(val, chosen))) continue;
        selectedValidators.push(val);
      }
    } else {
      const validatorDomainGroups = new Map<string, ScheduledTask[]>();
      for (const task of rankedValidators) {
        const domain = classifyTaskDomain(task);
        const group = validatorDomainGroups.get(domain) ?? [];
        group.push(task);
        validatorDomainGroups.set(domain, group);
      }

      const sortedValDomains = Array.from(validatorDomainGroups.keys()).sort();
      let madeValProgress = true;
      while (
        madeValProgress &&
        selectedImplementers.length + selectedValidators.length < maxParallel
      ) {
        madeValProgress = false;
        for (const domain of sortedValDomains) {
          if (selectedImplementers.length + selectedValidators.length >= maxParallel) break;
          const group = validatorDomainGroups.get(domain) ?? [];
          let candidateIndex = -1;
          for (let i = 0; i < group.length; i++) {
            const candidate = group[i]!;
            if (
              !selectedValidators.some((chosen) => conflicts(candidate, chosen)) &&
              !selectedImplementers.some((impl) => conflicts(candidate, impl))
            ) {
              candidateIndex = i;
              break;
            }
          }
          if (candidateIndex >= 0) {
            const [chosen] = group.splice(candidateIndex, 1);
            if (chosen) {
              selectedValidators.push(chosen);
              madeValProgress = true;
            }
          }
        }
      }
    }
  }

  const implementerDispatches: MultiDomainTaskDispatch[] = selectedImplementers.map((t) => ({
    taskId: t.id,
    domain: classifyTaskDomain(t),
    role: "implementer" as const,
    priority: t.priority,
    writeScope: [...t.write_scope],
    resourceScope: [...(t.resource_scope ?? [])],
    requirementIds: [...t.requirement_ids],
    status: String(t.status),
  }));

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

  const allDispatches: MultiDomainTaskDispatch[] = [
    ...implementerDispatches,
    ...validatorDispatches,
  ];

  const activeDomains = Array.from(new Set(allDispatches.map((d) => d.domain))).sort();

  let scopeIsolated = true;
  for (let i = 0; i < allDispatches.length; i++) {
    const a = allDispatches[i]!;
    for (let j = i + 1; j < allDispatches.length; j++) {
      const b = allDispatches[j]!;
      if (
        conflicts(
          { write_scope: a.writeScope, resource_scope: a.resourceScope },
          { write_scope: b.writeScope, resource_scope: b.resourceScope },
        )
      ) {
        scopeIsolated = false;
        break;
      }
    }
    if (!scopeIsolated) break;
    for (const occ of occupiedTasks) {
      if (occ.id !== a.taskId) {
        if (
          conflicts(
            { write_scope: a.writeScope, resource_scope: a.resourceScope },
            { write_scope: occ.write_scope, resource_scope: occ.resource_scope ?? [] },
          )
        ) {
          scopeIsolated = false;
          break;
        }
      }
    }
    if (!scopeIsolated) break;
  }

  return {
    parallelismFactor: pFactor,
    isMultiDomainActive,
    mandatedConcurrentDomains: isMultiDomainActive,
    implementerDispatches,
    validatorDispatches,
    allDispatches,
    activeDomains,
    distinctDomainCount: activeDomains.length,
    maxParallel,
    scopeIsolated,
  };
}
