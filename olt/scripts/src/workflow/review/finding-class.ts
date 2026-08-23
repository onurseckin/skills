import type { Finding } from "../../core/contracts/workflow.ts";

export type FindingClass = "defect" | "probe_demand";

export const FINDING_CLASSES: readonly FindingClass[] = ["defect", "probe_demand"];

const CLASS_NAMES = new Set<string>(FINDING_CLASSES);

export function isFindingClass(value: unknown): value is FindingClass {
  return typeof value === "string" && CLASS_NAMES.has(value);
}

export function findingClassOf(finding: Finding): FindingClass | null {
  return isFindingClass(finding.class) ? finding.class : null;
}

export function isProbeDemand(finding: Finding): boolean {
  return findingClassOf(finding) === "probe_demand";
}
