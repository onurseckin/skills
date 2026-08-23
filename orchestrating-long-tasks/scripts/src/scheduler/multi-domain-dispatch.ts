import { extname } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import { dependencyMap } from "../graph/dependency-map.ts";
import { isInteger, isRecord } from "../requirements/predicates.ts";
import { taskExecutionState } from "../workflow/authority/execution-state.ts";
import {
  applicableValidatorDomains,
  type ValidatorDomain,
  VALIDATOR_DOMAINS,
} from "../contracts/workflow.ts";
import { hasActiveOwnership, resourceConflict, scopeConflict } from "./conflicts.ts";
import { schedulingMetrics } from "./metrics.ts";
import { rankTasks, type ScheduledTask } from "./rank.ts";
import { computeWorkSpanMetrics } from "./dynamic-topology.ts";

/**
 * Parallelism factor threshold for triggering simultaneous multi-domain dispatch.
 * When P >= 2.5, multi-domain concurrent dispatch is mandated and enabled.
 */
export const MULTI_DOMAIN_PARALLELISM_THRESHOLD = 2.5;

export type TaskDomain =
  | "frontend-ui"
  | "backend-system"
  | "security-auth"
  | "product-experience"
  | "core-engine"
  | (string & {});

export interface MultiDomainTaskDispatch {
  readonly taskId: string;
  readonly domain: string;
  readonly role: "implementer" | "validator";
  readonly validatorDomain?: ValidatorDomain | undefined;
  readonly priority: number;
  readonly writeScope: readonly string[];
  readonly resourceScope: readonly string[];
  readonly requirementIds: readonly string[];
  readonly status: string;
}

export interface MultiDomainBatchOptions {
  readonly maxParallel?: number | null | undefined;
  readonly parallelismFactor?: number | undefined;
  readonly allowSimultaneousValidators?: boolean | undefined;
  readonly requireDisjointDomains?: boolean | undefined;
}

export interface MultiDomainBatchResult {
  readonly parallelismFactor: number;
  readonly isMultiDomainActive: boolean;
  readonly mandatedConcurrentDomains: boolean;
  readonly implementerDispatches: readonly MultiDomainTaskDispatch[];
  readonly validatorDispatches: readonly MultiDomainTaskDispatch[];
  readonly allDispatches: readonly MultiDomainTaskDispatch[];
  readonly activeDomains: readonly string[];
  readonly distinctDomainCount: number;
  readonly maxParallel: number;
  readonly scopeIsolated: boolean;
}

export interface MultiDomainValidatorDispatchOptions {
  readonly maxParallel?: number | null | undefined;
  readonly parallelismFactor?: number | undefined;
  readonly activeImplementerScopes?: readonly (readonly string[])[] | undefined;
  readonly activeResourceScopes?: readonly (readonly string[])[] | undefined;
}

export interface MultiDomainValidatorDispatchResult {
  readonly parallelismFactor: number;
  readonly isMultiDomainActive: boolean;
  readonly validatorDispatches: readonly MultiDomainTaskDispatch[];
  readonly dispatchedDomains: readonly string[];
  readonly eligibleSubmittedTasks: number;
  readonly scopeIsolated: boolean;
}

export interface MultiDomainBlockedTaskInfo {
  readonly taskId: string;
  readonly status: string;
  readonly blockingReason: string;
  readonly prerequisites: readonly string[];
  readonly unsatisfiedPrerequisites: readonly string[];
}

export interface MultiDomainWaveOptions extends MultiDomainBatchOptions {
  readonly clock?: { now: () => Date } | undefined;
}

export interface MultiDomainWaveResult extends MultiDomainBatchResult {
  readonly wave: number;
  readonly evaluatedAt: string;
  readonly blockedTasks: readonly MultiDomainBlockedTaskInfo[];
  readonly activeOccupiedTasks: readonly string[];
}

const DISPATCHABLE_STATUSES = new Set(["proposed", "ready", "retry_ready"]);

export function isMultiDomainDispatchEligible(parallelismFactor: number): boolean {
  return parallelismFactor >= MULTI_DOMAIN_PARALLELISM_THRESHOLD;
}

/**
 * Classifies a task into a primary domain based on its domain attributes,
 * write scopes, and requirement texts.
 */
export function classifyTaskDomain(
  task: unknown,
  requirementTexts: readonly string[] = [],
): string {
  if (!isRecord(task)) {
    return "core-engine";
  }

  if (typeof task.domain === "string" && task.domain.trim().length > 0) {
    return task.domain.trim();
  }
  if (typeof task.primary_domain === "string" && task.primary_domain.trim().length > 0) {
    return task.primary_domain.trim();
  }
  if (typeof task.validator_domain === "string" && task.validator_domain.trim().length > 0) {
    const val = task.validator_domain.trim();
    if (val === "ui-design") return "frontend-ui";
    if (val === "system-design") return "backend-system";
    if (val === "security") return "security-auth";
    if (val === "product") return "product-experience";
    if (val === "code-quality") return "core-engine";
    return val;
  }

  const writeScope: string[] = Array.isArray(task.write_scope)
    ? task.write_scope.filter((s): s is string => typeof s === "string")
    : [];

  const validatorDomains = applicableValidatorDomains(writeScope, requirementTexts);
  if (validatorDomains.includes("ui-design")) {
    return "frontend-ui";
  }
  if (validatorDomains.includes("system-design")) {
    return "backend-system";
  }

  for (const s of writeScope) {
    const scopeLower = s.toLowerCase();
    if (
      scopeLower.includes("ui") ||
      scopeLower.includes("frontend") ||
      scopeLower.includes("components/") ||
      scopeLower.includes("views/")
    ) {
      return "frontend-ui";
    }
    if (
      scopeLower.includes("backend") ||
      scopeLower.includes("api/") ||
      scopeLower.includes("server/") ||
      scopeLower.includes("db/")
    ) {
      return "backend-system";
    }
    if (
      scopeLower.includes("auth") ||
      scopeLower.includes("security") ||
      scopeLower.includes("crypto") ||
      scopeLower.includes("jwt")
    ) {
      return "security-auth";
    }
  }

  return "core-engine";
}

/**
 * Derives the most specific validator domain for a task.
 */
export function derivePrimaryValidatorDomain(
  task: unknown,
  requirementTexts: readonly string[] = [],
): ValidatorDomain {
  if (isRecord(task)) {
    if (
      typeof task.validator_domain === "string" &&
      VALIDATOR_DOMAINS.includes(task.validator_domain as ValidatorDomain)
    ) {
      return task.validator_domain as ValidatorDomain;
    }
    const writeScope: string[] = Array.isArray(task.write_scope)
      ? task.write_scope.filter((s): s is string => typeof s === "string")
      : [];
    const domains = applicableValidatorDomains(writeScope, requirementTexts);
    if (domains.includes("ui-design")) return "ui-design";
    if (domains.includes("system-design")) return "system-design";
  }
  return "code-quality";
}

/**
 * Checks if dual-validation (or multi-validator pairing) is required for a task.
 */
export function isDualValidationRequired(
  task: unknown,
  requirementTexts: readonly string[] = [],
): boolean {
  if (!isRecord(task)) return false;
  const writeScope: string[] = Array.isArray(task.write_scope)
    ? task.write_scope.filter((s): s is string => typeof s === "string")
    : [];
  const domains = applicableValidatorDomains(writeScope, requirementTexts);
  return domains.length >= 2;
}

/**
 * Returns all required validator domains for a task.
 */
export function getRequiredValidatorDomains(
  task: unknown,
  requirementTexts: readonly string[] = [],
): ValidatorDomain[] {
  if (!isRecord(task)) return ["code-quality"];
  const writeScope: string[] = Array.isArray(task.write_scope)
    ? task.write_scope.filter((s): s is string => typeof s === "string")
    : [];
  return applicableValidatorDomains(writeScope, requirementTexts);
}

function normalizeTask(id: string, value: unknown): ScheduledTask | null {
  if (!isRecord(value)) return null;
  if (typeof id !== "string" || id.length === 0) return null;

  const priority = typeof value.priority === "number" && isInteger(value.priority) ? value.priority : 1;
  const createdOrder =
    typeof value.created_order === "number" && isInteger(value.created_order)
      ? value.created_order
      : 10;
  const effort =
    typeof value.effort === "number" && isInteger(value.effort) && value.effort > 0
      ? value.effort
      : 1;

  const requirementIds: string[] = Array.isArray(value.requirement_ids)
    ? value.requirement_ids.filter((item): item is string => typeof item === "string")
    : [];

  const writeScope: string[] = Array.isArray(value.write_scope)
    ? value.write_scope.filter((item): item is string => typeof item === "string")
    : [];

  const resourceScope: string[] = Array.isArray(value.resource_scope)
    ? value.resource_scope.filter((item): item is string => typeof item === "string")
    : [];

  const status = typeof value.status === "string" ? value.status : "proposed";

  return {
    id,
    label: typeof value.label === "string" ? value.label : id,
    priority,
    created_order: createdOrder,
    effort,
    requirement_ids: requirementIds,
    write_scope: writeScope,
    resource_scope: resourceScope,
    status,
    domain: typeof value.domain === "string" ? value.domain : undefined,
    primary_domain: typeof value.primary_domain === "string" ? value.primary_domain : undefined,
    validator_domain: typeof value.validator_domain === "string" ? value.validator_domain : undefined,
  };
}

function conflicts(
  left: { write_scope: readonly string[]; resource_scope?: readonly string[] },
  right: { write_scope: readonly string[]; resource_scope?: readonly string[] },
): boolean {
  return (
    scopeConflict(left.write_scope, right.write_scope) ||
    resourceConflict(left.resource_scope ?? [], right.resource_scope ?? [])
  );
}

function occupiesScope(task: ScheduledTask): boolean {
  const status = String(task.status);
  return hasActiveOwnership(status) && !DISPATCHABLE_STATUSES.has(status) && status !== "submitted";
}

/**
 * Computes or retrieves the effective parallelism factor P from state or options.
 */
export function resolveParallelismFactor(state: unknown, explicitFactor?: number): number {
  if (explicitFactor !== undefined) {
    if (typeof explicitFactor !== "number" || Number.isNaN(explicitFactor) || explicitFactor < 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "parallelismFactor must be a non-negative number",
      );
    }
    return Number(explicitFactor.toFixed(2));
  }

  if (isRecord(state)) {
    if (isRecord(state.graph) && isRecord(state.tasks)) {
      try {
        const dependencies = dependencyMap(state.graph);
        const tasks = new Map<string, ScheduledTask>();
        for (const [id, value] of Object.entries(state.tasks)) {
          const norm = normalizeTask(id, value);
          if (norm) tasks.set(id, norm);
        }
        if (tasks.size > 0) {
          const metrics = computeWorkSpanMetrics(dependencies, tasks);
          return metrics.parallelismFactor;
        }
      } catch {
        // Fallback to state metrics below
      }
    }

    if (typeof state.workParallelismRatio === "number" && !Number.isNaN(state.workParallelismRatio)) {
      return Number(state.workParallelismRatio.toFixed(2));
    }
    if (typeof state.parallelismFactor === "number" && !Number.isNaN(state.parallelismFactor)) {
      return Number(state.parallelismFactor.toFixed(2));
    }
  }

  return 1.0;
}

/**
 * Evaluates a batch of tasks for dispatch, enforcing simultaneous multi-domain dispatch
 * when parallelism factor P >= 2.5 and allowing simultaneous validator dispatch across
 * disjoint domains alongside implementers.
 */
export function evaluateMultiDomainBatch(
  state: unknown,
  options: MultiDomainBatchOptions = {},
): MultiDomainBatchResult {
  const maxParallel = options.maxParallel !== undefined && options.maxParallel !== null
    ? options.maxParallel
    : 10;

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

  // 1. Filter implementer candidates
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
    // Normal sequential / priority dispatch (P < 2.5)
    for (const candidate of rankedImplementers) {
      if (selectedImplementers.some((chosen) => conflicts(candidate, chosen))) continue;
      selectedImplementers.push(candidate);
      if (selectedImplementers.length >= maxParallel) break;
    }
  } else {
    // Simultaneous Multi-Domain Concurrent Dispatch (P >= 2.5)
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

  // 2. Filter and evaluate submitted tasks for simultaneous multi-validator dispatch
  const selectedValidators: ScheduledTask[] = [];
  const allowValidators =
    options.allowSimultaneousValidators !== undefined
      ? options.allowSimultaneousValidators
      : isMultiDomainActive;

  if (allowValidators) {
    const submittedTasks = [...allTasks.values()].filter(
      (task) => task.status === "submitted",
    );

    const eligibleValidators = submittedTasks.filter((task) => {
      // Must not conflict with occupied tasks
      if (occupiedTasks.some((running) => running.id !== task.id && conflicts(task, running))) {
        return false;
      }
      // Must not conflict with any selected implementer
      if (selectedImplementers.some((impl) => conflicts(task, impl))) return false;
      return true;
    });

    const rankedValidators = rankTasks(eligibleValidators, metrics);

    if (!isMultiDomainActive) {
      // If forced allowValidators when P < 2.5, sequential selection
      for (const val of rankedValidators) {
        if (selectedImplementers.length + selectedValidators.length >= maxParallel) break;
        if (selectedValidators.some((chosen) => conflicts(val, chosen))) continue;
        selectedValidators.push(val);
      }
    } else {
      // P >= 2.5: Multi-domain validator round-robin dispatch across disjoint domains
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

  // 3. Construct dispatch objects
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

  // 4. Verify scope isolation across all dispatches
  let scopeIsolated = true;
  for (let i = 0; i < allDispatches.length; i++) {
    const a = allDispatches[i]!;
    for (let j = i + 1; j < allDispatches.length; j++) {
      const b = allDispatches[j]!;
      if (
        scopeConflict(a.writeScope, b.writeScope) ||
        resourceConflict(a.resourceScope, b.resourceScope)
      ) {
        scopeIsolated = false;
        break;
      }
    }
    if (!scopeIsolated) break;
    for (const occ of occupiedTasks) {
      if (occ.id !== a.taskId) {
        if (
          scopeConflict(a.writeScope, occ.write_scope) ||
          resourceConflict(a.resourceScope, occ.resource_scope ?? [])
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

/**
 * Dispatches validators across distinct domains when P >= 2.5, ensuring disjointness
 * with active implementer scopes and existing occupied tasks.
 */
export function dispatchMultiDomainValidators(
  state: unknown,
  options: MultiDomainValidatorDispatchOptions = {},
): MultiDomainValidatorDispatchResult {
  const maxParallel = options.maxParallel !== undefined && options.maxParallel !== null
    ? options.maxParallel
    : 10;

  if (!isInteger(maxParallel) || maxParallel < 1) {
    throw new HarnessError("INVALID_ARGUMENT", "maxParallel must be a positive integer");
  }

  if (!isRecord(state) || !isRecord(state.tasks)) {
    throw new HarnessError("INVALID_STATE", "tasks must be present to evaluate validator dispatch");
  }

  const pFactor = resolveParallelismFactor(state, options.parallelismFactor);
  const isMultiDomainActive = isMultiDomainDispatchEligible(pFactor);

  const allTasks = new Map<string, ScheduledTask>();
  for (const [id, value] of Object.entries(state.tasks)) {
    const norm = normalizeTask(id, value);
    if (norm) allTasks.set(id, norm);
  }

  const occupiedTasks = [...allTasks.values()].filter(occupiesScope);
  const activeImplementerScopes = options.activeImplementerScopes ?? [];
  const activeResourceScopes = options.activeResourceScopes ?? [];

  const submittedTasks = [...allTasks.values()].filter(
    (task) => task.status === "submitted",
  );

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

/**
 * Proposes a complete multi-domain wave with implementers and concurrent validators,
 * returning full wave metadata and blocked task diagnostics.
 */
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
