export type {
  ActionRecord,
  ActiveLeaseInfo,
  CognitivePillar,
  CognitivePillarId,
  DriftFinding,
  DriftSeverity,
  ReflexiveAuditContext,
  ReflexiveAuditEvaluation,
  ReflexiveCheckType,
  RoleBoundaryProfile,
  ScopeOverlapConflict,
  SubordinateAgentInfo,
  SubordinateHealthSummary,
  SupervisoryRole,
  WatchdogAuditPromptOptions,
  WatchdogGroundingInjection,
  WatchdogPersonaGroundingOptions,
} from "./types.ts";

export { SEVERITY_WEIGHTS, SUPERVISORY_ROLE_BOUNDARIES } from "./constants.ts";

export {
  findOverlappingScopes,
  getAllRoleBoundaryProfiles,
  getRoleBoundaryProfile,
  isSupervisoryRole,
  normalizeSupervisoryRole,
  parseNowMs,
} from "./profiles.ts";

export { evaluateReflexiveSelfAudit } from "./evaluator.ts";

export {
  buildWatchdogAuditPrompt,
  createWatchdogTickReminder,
  formatReflexiveAuditEvaluation,
  generateWatchdogPersonaGrounding,
  invalidatePersonaVerificationCaches,
} from "./generator.ts";
