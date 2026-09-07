export { PLANNING_PROPOSALS_SUITES } from "./proposals/index.ts";
export { PLANNING_HIERARCHY_SUITES } from "./hierarchy/index.ts";
export { PLANNING_REVISION_SUITES } from "./revision/index.ts";
export { PLANNING_PREPLANNING_SUITES } from "./preplanning/index.ts";
export { ARBITRATION_SUITES, ARBITRATION_EDGE_SUITES } from "./arbitration/index.ts";
export { PORTFOLIO_SUITES } from "./portfolio/index.ts";

export const PLANNING_DOMAINS = [
  "proposals",
  "hierarchy",
  "revision",
  "preplanning",
  "arbitration",
  "portfolio",
] as const;
