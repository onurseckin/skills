/**
 * Lane 10: Branch Domain Root Test Facade.
 * Re-exports domain facades across all 4 subdomains:
 * - scope/
 * - formatter/
 * - lifecycle/
 * - core/
 */

// 1. Scope Subdomain
export {
  assertSubScopes,
  scopeContains,
  scopeStrictlyContains,
} from "./scope/index.ts";

// 2. Formatter Subdomain
export {
  formatBranchCollectBrief,
  formatBranchStatusBrief,
} from "./formatter/index.ts";

// 3. Lifecycle Subdomain
export {
  isBranchOpen,
  isBranchStatus,
  isBranchSubTaskStatus,
  isSubTaskTerminal,
  openBranchIssues,
  readBranchLedger,
  writeBranchLedger,
  type BranchLease,
  type BranchRecord,
  type BranchStatus,
  type BranchSubTask,
  type BranchSubTaskStatus,
} from "./lifecycle/index.ts";

// 4. Core Subdomain
export {
  branchCapsule,
  branchChain,
  branchesOf,
  chainScope,
  cleanupRoots,
  eventKinds,
  openBranchVia,
  openChainLevel,
  taskOf,
  type BranchFixture,
  type ChainLink,
  type OpenOptions,
} from "./core/index.ts";
