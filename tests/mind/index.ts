/**
 * @file index.ts
 * Root Facade for Mind Test Suite
 * Aggregates all 8 semantic domains under tests/mind/
 */

export { DEFECTS_SUITES } from "./defects/index.ts";
export { EVAL_DOMAINS } from "./eval/index.ts";
export { PLANNING_DOMAINS } from "./planning/index.ts";
export { SYNTHESIS_DOMAINS } from "./synthesis/index.ts";
export { STRATEGY_DOMAINS } from "./strategy/index.ts";
export { HEURISTICS_DOMAINS } from "./heuristics/index.ts";
export { FEEDBACK_DOMAINS } from "./feedback/index.ts";
export { ASSEMBLY_DOMAINS } from "./assembly/index.ts";

export const MIND_DOMAINS = [
  "defects",
  "eval",
  "planning",
  "synthesis",
  "strategy",
  "heuristics",
  "feedback",
  "assembly",
] as const;
