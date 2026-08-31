/**
 * @file index.ts
 * Facade for Mind Eval Meta subpackage
 */

export { PlantedAuditHarness, type MindPlantedFixture } from "./meta-fixture.ts";

export const EVAL_META_SUITES = [
  "invariants",
  "remediation-synthesis",
  "feedback-injection",
  "forensics-reporting",
  "heuristics-core",
  "heuristics-roles",
  "heuristics-leases",
  "transcripts-and-cli",
] as const;
