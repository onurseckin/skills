export { GOVERNANCE_POLICY_SUITES } from "./policy/index.ts";
export { GOVERNANCE_DISPATCH_SUITES } from "./dispatch/index.ts";
export const STRATEGY_GOVERNANCE_SUITES = [
  "policy",
  "dispatch",
  "strategic-purpose",
  "self-evolution",
  "creative-pm",
] as const;
