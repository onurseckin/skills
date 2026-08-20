import type { Finding } from "../../contracts/workflow.ts";

/**
 * A `defect` asserts that something is broken. A `probe_demand` asserts nothing about the code: it
 * demands proof that a claim holds. The two travel through the same finding pipeline but drive
 * different counters, so they must never be inferred from severity or verdict alone.
 */
export type FindingClass = "defect" | "probe_demand";

export const FINDING_CLASSES: readonly FindingClass[] = ["defect", "probe_demand"];

const CLASS_NAMES = new Set<string>(FINDING_CLASSES);

export function isFindingClass(value: unknown): value is FindingClass {
  return typeof value === "string" && CLASS_NAMES.has(value);
}

/** Findings recorded before the class existed carry none; absent stays absent. */
export function findingClassOf(finding: Finding): FindingClass | null {
  return isFindingClass(finding.class) ? finding.class : null;
}

export function isProbeDemand(finding: Finding): boolean {
  return findingClassOf(finding) === "probe_demand";
}
