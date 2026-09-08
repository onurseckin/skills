import { readFileSync } from "node:fs";
import { DEFAULT_PURITY_BASELINE, parseBaseline } from "../purity-baseline/index.ts";
import type { PurityBaselineEntry } from "../purity-baseline/index.ts";
import type {
  PurityAllowance,
  PurityAuditScope,
  PurityExceedance,
  PurityTolerance,
  PurityViolation,
} from "./types.ts";

export const EMPTY_PURITY_ALLOWANCE: PurityAllowance = new Map<string, number>();

export function allowanceIdentity(file: string, rule: string): string {
  return `${file} ${rule}`;
}

export function buildPurityAllowance(entries: readonly PurityBaselineEntry[]): PurityAllowance {
  const allowance = new Map<string, number>();
  for (const entry of entries) {
    allowance.set(allowanceIdentity(entry.file, entry.rule), entry.count);
  }
  return allowance;
}

export function parsePurityAllowance(text: string): PurityAllowance {
  return buildPurityAllowance(parseBaseline(text).entries);
}

export function readPurityAllowance(
  baselinePath: string = DEFAULT_PURITY_BASELINE,
): PurityAllowance {
  try {
    return parsePurityAllowance(readFileSync(baselinePath, "utf-8"));
  } catch {
    return EMPTY_PURITY_ALLOWANCE;
  }
}

function compareExceedances(left: PurityExceedance, right: PurityExceedance): number {
  if (left.file < right.file) return -1;
  if (left.file > right.file) return 1;
  if (left.rule < right.rule) return -1;
  if (left.rule > right.rule) return 1;
  return 0;
}

export function partitionByAllowance(
  violations: readonly PurityViolation[],
  allowance: PurityAllowance = EMPTY_PURITY_ALLOWANCE,
): PurityTolerance {
  const observed = new Map<string, number>();
  for (const violation of violations) {
    const identity = allowanceIdentity(violation.file, violation.rule);
    observed.set(identity, (observed.get(identity) ?? 0) + 1);
  }

  const exceeded = new Set<string>();
  const exceedances: PurityExceedance[] = [];
  for (const [identity, count] of observed) {
    const allowed = allowance.get(identity) ?? 0;
    if (count > allowed) exceeded.add(identity);
  }

  const blocking: PurityViolation[] = [];
  const tolerated: PurityViolation[] = [];
  for (const violation of violations) {
    const identity = allowanceIdentity(violation.file, violation.rule);
    if (exceeded.has(identity)) blocking.push(violation);
    else tolerated.push(violation);
  }

  for (const identity of exceeded) {
    const first = violations.find(
      (violation) => allowanceIdentity(violation.file, violation.rule) === identity,
    );
    if (first === undefined) continue;
    exceedances.push({
      file: first.file,
      rule: first.rule,
      observed: observed.get(identity) ?? 0,
      allowed: allowance.get(identity) ?? 0,
    });
  }

  return { blocking, tolerated, exceedances: exceedances.sort(compareExceedances) };
}

export function allowanceAppliesTo(scope: PurityAuditScope, strict: boolean): boolean {
  if (strict) return false;
  return scope === "staged" || scope === "explicit" || scope === "repository";
}
