export { CLI_DEFECTS_META_SUITES } from "./meta/index.ts";
export { CLI_DEFECTS_AUDIT_SUITES } from "./audit/index.ts";

export const CLI_GOVERNANCE_DEFECTS_SUITES = [
  "defect-ops",
  "finding-ops",
  "finding-remediation-resolution",
  "finding-resolution-advanced",
  "finding-resolution-edge",
  "finding-resolution-ops",
  "repair-attribution-ops",
  "repair-loop-ops",
] as const;
