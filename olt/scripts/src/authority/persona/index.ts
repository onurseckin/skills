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

export {
  ANTI_MAKEWORK_PILLARS,
  PRODUCT_CRAFT_PILLARS,
  SEVERITY_WEIGHTS,
  SUPERVISORY_ROLE_BOUNDARIES,
  THREE_STRIKE_CONTAINMENT_RULES,
} from "./constants.ts";

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
