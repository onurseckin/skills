/**
 * @file index.ts
 * Root Facade for Governance domain
 */

export { GOVERNANCE_FIXTURES_SUITES, scratchRoot, createSandboxDir } from "./fixtures/index.ts";
export { GOVERNANCE_POLICY_SUITES } from "./policy/index.ts";
export { GOVERNANCE_ENFORCEMENT_SUITES } from "./enforcement/index.ts";
export { GOVERNANCE_AUDIT_SUITES } from "./audit/index.ts";
export { GOVERNANCE_SYNC_SUITES } from "./sync/index.ts";

export const GOVERNANCE_DOMAINS = [
  "fixtures",
  "policy",
  "enforcement",
  "audit",
  "sync",
] as const;
