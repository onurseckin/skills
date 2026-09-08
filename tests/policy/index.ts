import * as audit from "./audit/index.ts";
import * as engine from "./engine/index.ts";
import * as hooks from "./hooks/index.ts";
import * as io from "./io/index.ts";
import * as rbac from "./rbac/index.ts";
import * as review from "./review/index.ts";
import * as schema from "./schema/index.ts";
import * as toolchain from "./toolchain/index.ts";

export { audit, engine, hooks, io, rbac, review, schema, toolchain };
export {
  setupVirtualPolicyFS,
  cleanupVirtualPolicyFS,
  getVirtualPolicyFS,
  scratchRoot,
  createSandboxDir,
} from "./fixture.ts";

export {
  computeAuditRecordHash,
  verifyAuditTrailChain,
  AuditTrailWriter,
  SecurityAuditLogger,
  ViolationAlertDispatcher,
} from "./audit/index.ts";

export {
  executePolicyHook,
  generateCanonicalDefaultPolicy,
  generateDefaultRepoPolicy,
  initRepoPolicy,
  inspectRepoPolicy,
  loadRepoPolicy,
  saveRepoPolicy,
  enforceRepoPolicy,
  checkAndHandlePolicyDrift,
  computePolicyChecksum,
  detectPolicyDrift,
  handlePolicyDrift,
  auditPermissionHealth,
} from "./engine/index.ts";

export {
  formatDuration,
  formatHookDuration,
  interpolateHookCommand,
  interpolateLifecycleHookCommand,
  DEFAULT_POLICY_HOOKS,
  evaluatePolicyHooksEngine,
  executeHookCommand,
  executeLifecycleHooks,
  executePolicyLifecycleHooks,
  parseCommandLineArgs,
  validatePolicyHooksConfiguration,
} from "./hooks/index.ts";

export {
  assertOwnedPrivateFile,
  assertRealDir,
  checkExistingDir,
  ensureDir,
  isInside,
  readVerifiedFile,
  reqNoFollow,
  resolvePolicyLocation,
  resolveSystemLockPath,
  sameInode,
  withLock,
} from "./io/index.ts";

export {
  compileEffectiveForbiddenPatterns,
  isTargetTestArgument,
  isUntargetedTestCommand,
  hasUnshieldedSubshellOrChaining,
  isCommandAuthorizedForRole,
  isActionAllowedForRole,
  FORBIDDEN_SUPERVISOR_PATTERNS,
  FORBIDDEN_COGNITIVE_VALIDATOR_PATTERNS,
  FORBIDDEN_IMPLEMENTER_PATTERNS,
} from "./rbac/index.ts";

export {
  assertReviewProtocolSatisfied,
  canFinalizeReview,
  DEFAULT_REVIEW_PROTOCOL_CONFIG,
  evaluateReviewPhase,
  projectTaskReviewState,
  resolveReviewProtocolConfig,
  ReviewProtocolEngine,
  assertValidPolicy,
  isPolicyValid,
  validateCommandIntegrity,
  validateHooksIntegrity,
  validatePlanningPolicy,
  validatePolicy,
  validatePolicyStructure,
  validateReviewProtocol,
} from "./review/index.ts";

export {
  parseRepoPolicy,
  validateRepoPolicy,
  CURRENT_POLICY_SCHEMA_VERSION,
  canonicalHosts,
  canonicalPolicy,
} from "./schema/index.ts";

export {
  discoverToolchain,
  scanRepositoryToolchain,
  synthesizeCalibratedRepoPolicy,
  readMakefile,
  readPackageJson,
  readPythonManifests,
  readTurboJson,
  getCargoPresets,
  getPythonPresets,
  getUnknownPresets,
} from "./toolchain/index.ts";
