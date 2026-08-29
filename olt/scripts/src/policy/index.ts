export {
  CURRENT_POLICY_SCHEMA_VERSION,
  type AgentHostPolicy,
  type AgentPolicy,
  type DockerTestProfile,
  type PlanningPolicy,
  type RepoEcosystem,
  type RepoPolicy,
  type ReviewProtocolPolicy,
  type TestRunnerPolicy,
} from "./types.ts";

export type { Location, RepoPolicyReadDependencies } from "./io-safety.ts";

export type { PolicyInspectionResult, RepoPolicyWriteDependencies } from "./repo-policy.ts";

export type {
  PolicyReloadEvent,
  PolicyDriftCallbacks,
  PolicyDriftResult,
} from "./drift-detector.ts";

export {
  DEFAULT_REVIEW_PROTOCOL_POLICY,
  DEFAULT_PLANNING_POLICY,
  detectRepoEcosystem,
  generateCanonicalDefaultPolicy,
  generateDefaultRepoPolicy,
} from "./generator.ts";

export { parseRepoPolicy } from "./schema.ts";

export {
  computePolicyChecksum,
  detectPolicyDrift,
  handlePolicyDrift,
  checkAndHandlePolicyDrift,
} from "./drift-detector.ts";

export {
  reqNoFollow,
  sameInode,
  safeMsg,
  assertOwnedPrivateFile,
  assertRealDir,
  isInside,
  ensureDir,
  checkExistingDir,
  resolvePolicyLocation,
  readVerifiedFile,
  withLock,
} from "./io-safety.ts";

export {
  parseAuthorityRepoPolicy,
  validateRepoPolicy,
  inspectRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
  initRepoPolicy,
} from "./repo-policy.ts";

export { auditPermissionHealth } from "./permission-health.ts";
