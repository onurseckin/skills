import { isIdentifier, isInteger, isNonblank, isRecord, isRepoRelativePath } from "./predicates.ts";

const RISKS = new Set(["low", "medium", "high", "critical"]);
const DISPOSITIONS = new Set(["actionable", "needs_authority"]);
const MAX_PRIORITY = 1_000_000;

function nonblankList(value: unknown, label: string, issues: string[]): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be a list`);
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isNonblank(item)) issues.push(`${label} must contain non-blank text`);
    else if (seen.has(item)) issues.push(`${label} contains duplicate ${item}`);
    else {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function validateCandidateGates(value: unknown, prefix: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${prefix}.candidate_gates must be a non-empty list`);
    return;
  }
  value.forEach((candidate, index) => {
    const label = `${prefix}.candidate_gates[${index}]`;
    if (!isRecord(candidate)) {
      issues.push(`${label} must be an object`);
      return;
    }
    if (
      !Array.isArray(candidate.argv) ||
      candidate.argv.length === 0 ||
      !candidate.argv.every(isNonblank)
    ) {
      issues.push(`${label}.argv must be a non-empty string list`);
    }
    if (!isRepoRelativePath(candidate.cwd, true))
      issues.push(`${label}.cwd must be a normalized repository-relative path`);
  });
}

export function validateRequirementMetadata(
  requirement: Record<string, unknown>,
  prefix: string,
  issues: string[],
): string[] {
  for (const field of ["authority_status", "authority_history"] as const) {
    if (requirement[field] !== undefined) issues.push(`${prefix}.${field} is runtime-only`);
  }
  if (!isNonblank(requirement.subsystem)) issues.push(`${prefix}.subsystem must be non-blank text`);
  validateCandidateGates(requirement.candidate_gates, prefix, issues);
  if (
    !isInteger(requirement.priority) ||
    requirement.priority < 0 ||
    requirement.priority > MAX_PRIORITY
  ) {
    issues.push(`${prefix}.priority must be between 0 and ${MAX_PRIORITY}`);
  }
  if (typeof requirement.risk !== "string" || !RISKS.has(requirement.risk))
    issues.push(`${prefix}.risk is invalid`);
  nonblankList(requirement.ambiguity, `${prefix}.ambiguity`, issues);
  const dependencies = nonblankList(requirement.dependencies, `${prefix}.dependencies`, issues);
  if (dependencies.some((id) => !isIdentifier(id)))
    issues.push(`${prefix}.dependencies contains an invalid identifier`);
  if (requirement.disposition === "out_of_scope") {
    issues.push(`${prefix}.disposition cannot be out_of_scope in a plan; use needs_authority`);
  } else if (
    typeof requirement.disposition !== "string" ||
    !DISPOSITIONS.has(requirement.disposition)
  ) {
    issues.push(`${prefix}.disposition is invalid`);
  }
  return dependencies;
}

export function validateRequirementDependencies(
  dependencies: ReadonlyMap<string, readonly string[]>,
  requirementIds: ReadonlySet<string>,
  issues: string[],
): void {
  for (const [id, values] of dependencies) {
    for (const dependency of values) {
      if (dependency === id) issues.push(`requirement ${id} cannot depend on itself`);
      else if (!requirementIds.has(dependency))
        issues.push(`requirement ${id} references unknown dependency ${dependency}`);
    }
  }
  const remaining = new Map(
    [...requirementIds].map((id) => [
      id,
      new Set((dependencies.get(id) ?? []).filter((dependency) => requirementIds.has(dependency))),
    ]),
  );
  const ready = [...remaining].filter(([, values]) => values.size === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const resolved = ready.pop()!;
    visited += 1;
    for (const [id, values] of remaining) {
      if (values.delete(resolved) && values.size === 0) ready.push(id);
    }
  }
  if (visited !== remaining.size) issues.push("requirement dependencies contain a cycle");
}
