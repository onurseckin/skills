/**
 * @file index.ts
 * Facade for Mind Planning domain
 */

export { PLANNING_PROPOSALS_SUITES } from "./proposals/index.ts";
export { PLANNING_HIERARCHY_SUITES } from "./hierarchy/index.ts";
export { PLANNING_REVISION_SUITES } from "./revision/index.ts";
export { PLANNING_PREPLANNING_SUITES } from "./preplanning/index.ts";

export const PLANNING_DOMAINS = [
  "proposals",
  "hierarchy",
  "revision",
  "preplanning",
] as const;
