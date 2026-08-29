import type { CheckReport, Violation } from "../core/index.ts";
import type { ModularityBaseline } from "./baseline.ts";

function identity(violation: Violation): string {
  return violation.rule === "line_limit" ||
    violation.rule === "directory_fanout" ||
    violation.rule === "dependency_cycle"
    ? `${violation.rule}:${violation.path}`
    : `${violation.rule}:${violation.path}:${String(violation.observed)}`;
}

function index(violations: readonly Violation[]): Map<string, Violation> {
  const findings = new Map<string, Violation>();
  for (const violation of violations) {
    const key = identity(violation);
    if (findings.has(key))
      throw new Error(`Invalid modularity baseline: duplicate identity ${key}`);
    findings.set(key, violation);
  }
  return findings;
}

function worsened(baseline: Violation, current: Violation): boolean {
  return (
    typeof baseline.observed === "number" &&
    typeof current.observed === "number" &&
    current.observed > baseline.observed
  );
}

export function compareBaseline(
  baseline: ModularityBaseline,
  current: ModularityBaseline,
): Pick<CheckReport, "baselineDelta" | "passed"> {
  const expected = index(baseline.violations);
  const actual = index(current.violations);
  const added: Violation[] = [];
  const worsenedFindings: Violation[] = [];
  for (const [key, violation] of actual) {
    const existing = expected.get(key);
    if (!existing) added.push(violation);
    else if (worsened(existing, violation)) worsenedFindings.push(violation);
  }
  const resolved = [...expected]
    .filter(([key]) => !actual.has(key))
    .map(([, violation]) => violation);
  return {
    baselineDelta: { added, worsened: worsenedFindings, resolved },
    passed: added.length === 0 && worsenedFindings.length === 0,
  };
}
