/**
 * @file index.ts
 * Facade for Mind Heuristics domain
 */

export { HEURISTICS_SAFETY_SUITES } from "./safety/index.ts";
export { HEURISTICS_GUARDS_SUITES } from "./guards/index.ts";
export { HEURISTICS_WITNESS_SUITES } from "./witness/index.ts";
export { HEURISTICS_SOAK_SUITES } from "./soak/index.ts";

export const HEURISTICS_DOMAINS = [
  "safety",
  "guards",
  "witness",
  "soak",
] as const;
