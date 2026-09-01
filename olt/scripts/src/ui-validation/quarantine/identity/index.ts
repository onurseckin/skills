export type {
  SessionCookie,
  LocalStorageEntry,
  BrowserStorageOrigin,
  BrowserStorageState,
  PersonaSessionContext,
  SessionDegradationCause,
  SessionDegradationInspectionParams,
  SessionDegradationResult,
  ReauthExecutionPlan,
  PermissionAuditExpectation,
  PersonaAccessEvaluation,
  PermissionBoundaryAuditResult,
} from "./types.ts";

export {
  base64UrlEncode,
  base64UrlDecode,
  MOCK_JWT_SECRET,
} from "./types.ts";

export {
  IdentityGovernanceEngine,
  getDefaultIdentityGovernanceEngine,
  setDefaultIdentityGovernanceEngine,
  resetDefaultIdentityGovernanceEngine,
  detectSessionDegradation,
  executeAutonomousReauthentication,
  simulatePermissionBoundary,
} from "./engine.ts";
