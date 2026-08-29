import {
  applicableValidatorDomains,
  type ValidatorDomain,
  VALIDATOR_DOMAINS,
} from "../../../core/contracts/index.ts";
import { isInteger, isRecord } from "../../../requirements/predicates.ts";
import type { ScheduledTask } from "../conflict/rank.ts";

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

export const DISPATCHABLE_STATUSES = new Set(["proposed", "ready", "retry_ready"]);

export function isMultiDomainDispatchEligible(parallelismFactor: number): boolean {
  return parallelismFactor >= MULTI_DOMAIN_PARALLELISM_THRESHOLD;
}

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

export function normalizeTask(id: string, value: unknown): ScheduledTask | null {
  if (!isRecord(value)) return null;
  if (typeof id !== "string" || id.length === 0) return null;

  const priority =
    typeof value.priority === "number" && isInteger(value.priority) ? value.priority : 1;
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
    validator_domain:
      typeof value.validator_domain === "string" ? value.validator_domain : undefined,
  };
}
