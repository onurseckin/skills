/**
 * @file index.ts
 * Facade for Mind Strategy domain
 */

export { STRATEGY_LANES_SUITES } from "./lanes/index.ts";
export { STRATEGY_ROLES_SUITES } from "./roles/index.ts";
export { STRATEGY_GOVERNANCE_SUITES } from "./governance/index.ts";

export const STRATEGY_DOMAINS = [
  "lanes",
  "roles",
  "governance",
] as const;
