import type { CheckReport, Violation } from "../core/index.ts";
import type { ModularityBaseline } from "./baseline.ts";

function identity(violation: Violation): string {
  if (violation.rule === "line_limit" || violation.rule === "directory_fanout") {
    return `${violation.rule}:${violation.path}`;
  }
  return `${violation.rule}:${violation.path}:${String(violation.observed)}`;
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
  if (typeof baseline.observed !== "number") return false;
  if (typeof current.observed !== "number") return false;
  return current.observed > baseline.observed;
}

export function compareBaseline(
  baseline: ModularityBaseline,
  current: ModularityBaseline,
): Pick<CheckReport, "baselineDelta" | "passed"> {
  const baseNonCycle = baseline.violations.filter((v) => v.rule !== "dependency_cycle");
  const currNonCycle = current.violations.filter((v) => v.rule !== "dependency_cycle");
  const expected = index(baseNonCycle);
  const actual = index(currNonCycle);

  const added: Violation[] = [];
  const worsenedFindings: Violation[] = [];

  for (const [key, violation] of actual) {
    const existing = expected.get(key);
    if (!existing) {
      added.push(violation);
    } else if (worsened(existing, violation)) {
      worsenedFindings.push(violation);
    }
  }

  const resolved: Violation[] = [...expected]
    .filter(([key]) => !actual.has(key))
    .map(([, violation]) => violation);

  const baseCycles = baseline.violations.filter((v) => v.rule === "dependency_cycle");
  const currCycles = current.violations.filter((v) => v.rule === "dependency_cycle");

  for (const curr of currCycles) {
    const currNodes = String(curr.observed).split(",");
    const matchingBase = baseCycles.find((base) => {
      const baseNodes = new Set(String(base.observed).split(","));
      return currNodes.some((node) => baseNodes.has(node));
    });

    if (!matchingBase) {
      added.push(curr);
    } else {
      const baseNodes = new Set(String(matchingBase.observed).split(","));
      const hasNewNodes = currNodes.some((node) => !baseNodes.has(node));
      if (hasNewNodes || currNodes.length > baseNodes.size) {
        worsenedFindings.push(curr);
      }
    }
  }

  for (const base of baseCycles) {
    const baseNodes = new Set(String(base.observed).split(","));
    const hasActiveSubCycle = currCycles.some((curr) => {
      const currNodes = String(curr.observed).split(",");
      return currNodes.some((node) => baseNodes.has(node));
    });
    if (!hasActiveSubCycle) {
      resolved.push(base);
    }
  }

  return {
    baselineDelta: { added, worsened: worsenedFindings, resolved },
    passed: added.length === 0 && worsenedFindings.length === 0,
  };
}
