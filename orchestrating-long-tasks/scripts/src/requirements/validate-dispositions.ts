import { isInteger, isNonblank } from "./predicates.ts";

type RequirementLines = Map<string, Set<number>>;

const RATIONALE_KINDS = new Set(["context", "constraint", "non_actionable"]);

function dispositionIds(
  disposition: Record<string, unknown>,
  prefix: string,
  required: boolean,
  issues: string[],
): unknown[] {
  const hasSingular = disposition.requirement_id !== undefined;
  const hasPlural = disposition.requirement_ids !== undefined;
  if (!hasSingular && !hasPlural) {
    if (required)
      issues.push(`${prefix} must declare exactly one of requirement_id or requirement_ids`);
    return [];
  }
  if (hasSingular === hasPlural) {
    issues.push(`${prefix} must declare exactly one of requirement_id or requirement_ids`);
    return [];
  }
  if (!hasPlural) return [disposition.requirement_id];
  if (!Array.isArray(disposition.requirement_ids) || disposition.requirement_ids.length === 0) {
    issues.push(`${prefix}.requirement_ids must be a non-empty list`);
    return [];
  }
  return disposition.requirement_ids;
}

function linkDisposition(
  ids: readonly unknown[],
  line: number,
  prefix: string,
  requirementIds: ReadonlySet<string>,
  linked: RequirementLines,
  issues: string[],
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !requirementIds.has(id)) {
      issues.push(`${prefix} references an unknown requirement`);
    } else if (seen.has(id)) {
      issues.push(`${prefix} repeats requirement ${id}`);
    } else {
      seen.add(id);
      const sourceLines = linked.get(id) ?? new Set<number>();
      sourceLines.add(line);
      linked.set(id, sourceLines);
    }
  }
}

export function validateDispositions(
  entries: readonly Record<string, unknown>[],
  lines: readonly string[],
  requirementIds: ReadonlySet<string>,
  requirementDispositions: ReadonlyMap<string, unknown>,
  issues: string[],
): { disposed: Map<number, number>; linked: RequirementLines } {
  const disposed = new Map<number, number>();
  const linked: RequirementLines = new Map();
  entries.forEach((disposition, index) => {
    const prefix = `dispositions[${index}]`;
    const line = disposition.line;
    if (!isInteger(line) || line < 1 || line > lines.length) {
      issues.push(`${prefix}.line is outside the prompt`);
      return;
    }
    if (!lines[line - 1]!.trim()) issues.push(`${prefix}.line references a blank prompt line`);
    disposed.set(line, (disposed.get(line) ?? 0) + 1);
    const kind = typeof disposition.kind === "string" ? disposition.kind : "";
    if (kind === "needs_authority" || kind === "out_of_scope") {
      issues.push(`${prefix}.kind must be requirement for an obligation in version 1`);
    } else if (!["requirement", "context", "constraint", "non_actionable"].includes(kind)) {
      issues.push(`${prefix}.kind is invalid`);
      return;
    }
    const ids = dispositionIds(disposition, prefix, kind === "requirement", issues);
    if (kind === "requirement") {
      linkDisposition(ids, line, prefix, requirementIds, linked, issues);
    }
    const needsAuthorityRationale =
      kind === "requirement" &&
      ids.some(
        (id) => typeof id === "string" && requirementDispositions.get(id) === "needs_authority",
      );
    if (needsAuthorityRationale && !isNonblank(disposition.rationale)) {
      issues.push(`${prefix}.rationale is required when a linked requirement needs authority`);
    } else if (RATIONALE_KINDS.has(kind) && !isNonblank(disposition.rationale)) {
      issues.push(`${prefix}.rationale must be substantive non-blank text`);
    }
  });
  return { disposed, linked };
}
