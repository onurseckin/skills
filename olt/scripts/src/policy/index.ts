export {
  CURRENT_POLICY_SCHEMA_VERSION,
  type AgentHostPolicy,
  type AgentPolicy,
  type AgentSchedulerPolicy,
  type DockerTestProfile,
  type HostType,
  type PlanningPolicy,
  type RepoEcosystem,
  type RepoPolicy,
  type ReviewProtocolPolicy,
  type TestRunnerPolicy,
} from "./types/index.ts";

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
} from "./generator/index.ts";

export { parseRepoPolicy } from "./schema/index.ts";

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

export type {
  ReviewChannelEntry,
  ReviewChannelKind,
  ReviewPhase,
  ReviewProtocolConfig,
  ReviewTaskRecord,
  TaskReviewState,
} from "./review-protocol.ts";
export {
  DEFAULT_REVIEW_PROTOCOL_CONFIG,
  ReviewProtocolEngine,
  assertReviewProtocolSatisfied,
  canFinalizeReview,
  evaluateReviewPhase,
  extractReviewHistory,
  isTaskRecord,
  projectTaskReviewState,
  resolveReviewProtocolConfig,
} from "./review-protocol.ts";

export type { AuthorizationResult, TestRunnerSpec } from "./rbac/index.ts";
export {
  FORBIDDEN_SUBSHELL_AND_EVAL_PATTERNS,
  KNOWN_TEST_RUNNERS,
  STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS,
  STATIC_SUPERVISOR_FORBIDDEN_PATTERNS,
  compileEffectiveForbiddenPatterns,
  hasUnshieldedSubshellOrChaining,
  isTargetTestArgument,
  isUntargetedTestCommand,
  verifyCommandAuthorization,
} from "./rbac/index.ts";
