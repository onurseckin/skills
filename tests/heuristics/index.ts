/**
 * @file index.ts
 * Root facade for Domain 2 Heuristics test package
 */

export { HEURISTICS_EDGE_CASES_SUITES } from "./edge-cases/index.ts";

export const HEURISTICS_SUITES = [
  "behavioral-forensics",
  "behavioral-scoring",
  "heuristics",
  "edge-cases",
] as const;
