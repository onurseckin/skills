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
} from "./tokens.ts";

export {
  detectSessionDegradation,
  executeAutonomousReauthentication,
} from "./session.ts";

export {
  simulatePermissionBoundary,
} from "./permissions.ts";

export {
  IdentityGovernanceEngine,
  getDefaultIdentityGovernanceEngine,
  setDefaultIdentityGovernanceEngine,
  resetDefaultIdentityGovernanceEngine,
} from "./engine.ts";
