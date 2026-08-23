import { isIdentifier, isInteger, isNonblank, isRecord, objectList } from "./predicates.ts";
import { promptSource } from "./prompt-source.ts";
import {
  validateRequirementDependencies,
  validateRequirementMetadata,
} from "./validate-metadata.ts";
import { validateDispositions } from "./validate-dispositions.ts";

type RequirementLines = Map<string, Set<number>>;

function validateSourceLines(
  value: unknown,
  lines: readonly string[],
  prefix: string,
  issues: string[],
): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${prefix}.source_lines must be a non-empty list`);
    return [];
  }
  const valid: number[] = [];
  const seen = new Set<number>();
  for (const line of value) {
    if (!isInteger(line) || line < 1 || line > lines.length) {
      issues.push(`${prefix}.source_lines contains an invalid line`);
    } else if (seen.has(line)) {
      issues.push(`${prefix}.source_lines contains duplicate line ${line}`);
    } else if (!lines[line - 1]!.trim()) {
      issues.push(`${prefix}.source_lines references blank line ${line}`);
    } else {
      seen.add(line);
      valid.push(line);
    }
  }
  return valid;
}

function validateRequirementEntries(
  entries: readonly Record<string, unknown>[],
  lines: readonly string[],
  issues: string[],
): {
  ids: Set<string>;
  sourceLines: RequirementLines;
  dependencies: Map<string, string[]>;
} {
  const ids = new Set<string>();
  const acceptanceIds = new Set<string>();
  const sourceLines: RequirementLines = new Map();
  const dependencies = new Map<string, string[]>();
  entries.forEach((requirement, index) => {
    const prefix = `requirements[${index}]`;
    const id = requirement.id;
    if (!isIdentifier(id)) issues.push(`${prefix}.id must be a valid identifier`);
    else if (ids.has(id)) issues.push(`duplicate requirement id: ${id}`);
    else ids.add(id);
    const validLines = validateSourceLines(requirement.source_lines, lines, prefix, issues);
    if (typeof id === "string") sourceLines.set(id, new Set(validLines));
    const excerpt = validLines.map((line) => lines[line - 1]).join("\n");
    if (validLines.length === 0 || requirement.source_excerpt !== excerpt) {
      issues.push(`${prefix}.source_excerpt must exactly match its prompt lines`);
    }
    for (const field of ["instruction", "implementation"] as const) {
      if (!isNonblank(requirement[field])) issues.push(`${prefix}.${field} must be non-blank text`);
    }
    const requirementDependencies = validateRequirementMetadata(requirement, prefix, issues);
    if (typeof id === "string") dependencies.set(id, requirementDependencies);
    if (requirement.status !== "planned" || typeof requirement.status !== "string") {
      issues.push(`${prefix}.status must be the string 'planned'`);
    }
    const acceptance = objectList(requirement.acceptance, `${prefix}.acceptance`, issues);
    if (acceptance.length === 0)
      issues.push(`${prefix}.acceptance must contain at least one criterion`);
    acceptance.forEach((criterion, acceptanceIndex) => {
      const criterionPrefix = `${prefix}.acceptance[${acceptanceIndex}]`;
      if (!isIdentifier(criterion.id))
        issues.push(`${criterionPrefix}.id must be a valid identifier`);
      else if (acceptanceIds.has(criterion.id))
        issues.push(`duplicate acceptance id: ${criterion.id}`);
      else acceptanceIds.add(criterion.id);
      if (!isNonblank(criterion.criterion))
        issues.push(`${criterionPrefix}.criterion must be non-blank text`);
      if (
        !Array.isArray(criterion.evidence) ||
        criterion.evidence.length === 0 ||
        !criterion.evidence.every(isNonblank)
      ) {
        issues.push(`${criterionPrefix}.evidence must be a non-empty text list`);
      }
    });
  });
  return { ids, sourceLines, dependencies };
}

export function validateRequirements(prompt: unknown, document: unknown): string[] {
  const source = promptSource(prompt);
  if (!source) return ["prompt must be valid UTF-8 text or bytes"];
  if (!isRecord(document)) return ["requirements document must be an object"];
  const issues: string[] = [];
  if (document.schema !== "harness.requirements")
    issues.push("requirements schema must be harness.requirements");
  if (!isInteger(document.version) || document.version !== 1)
    issues.push("requirements version must be integer 1");
  if (document.prompt_sha256 !== source.digest)
    issues.push("requirements prompt digest does not match prompt.md");
  const lines = source.lines;
  const requirements = objectList(document.requirements, "requirements", issues);
  const dispositions = objectList(document.dispositions, "dispositions", issues);
  const { ids, sourceLines, dependencies } = validateRequirementEntries(
    requirements,
    lines,
    issues,
  );
  validateRequirementDependencies(dependencies, ids, issues);
  const requirementDispositions = new Map(
    requirements
      .filter((requirement) => typeof requirement.id === "string")
      .map((requirement) => [requirement.id as string, requirement.disposition]),
  );
  const { disposed, linked } = validateDispositions(
    dispositions,
    lines,
    ids,
    requirementDispositions,
    issues,
  );
  lines.forEach((line, index) => {
    const number = index + 1;
    if (line.trim() && disposed.get(number) !== 1)
      issues.push(`nonblank prompt line ${number} must have exactly one disposition`);
    if (!line.trim() && (disposed.get(number) ?? 0) > 0)
      issues.push(`blank prompt line ${number} cannot have a disposition`);
  });
  for (const [id, expected] of sourceLines) {
    const actual = linked.get(id) ?? new Set<number>();
    if (expected.size !== actual.size || [...expected].some((line) => !actual.has(line))) {
      issues.push(`requirement ${id} dispositions must match its source lines`);
    }
  }
  return issues;
}
