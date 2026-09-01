export type {
  OpticalQuarantineInvariant,
  QuarantineCategory,
  ToolDescriptor,
  ToolInvocationContext,
  QuarantineCheckResult,
  BackdoorDetectionResult,
  QuarantineEnforcementResult,
  QuarantineAuditRecord,
} from "./tools/index.ts";

export {
  OPTICAL_QUARANTINE_INVARIANTS,
  PERMITTED_IMAGE_EXTENSIONS,
  FORBIDDEN_SOURCE_EXTENSIONS,
  AUTHORIZED_BROWSER_TOOLS,
  AUTHORIZED_VISUAL_TOOLS,
  AUTHORIZED_MESSAGING_TOOLS,
  FORBIDDEN_TOOLS,
  EVALUATE_SCRIPT_HOST_FS_PATTERNS,
  SHELL_INJECTION_PATTERNS,
  LOCAL_URL_BYPASS_PATTERNS,
  isOpticalValidatorRole,
  verifyCapability,
  detectBackdoorBypass,
  ToolQuarantineEngine,
  getDefaultQuarantineEngine,
  setDefaultQuarantineEngine,
  resetDefaultQuarantineEngine,
} from "./tools/index.ts";

export type {
  ApplicationEndpoints,
  RunningPortInfo,
  CookieTemplateSpec,
  PersonaDefinition,
  FeatureScope,
  DeductiveParameters,
  ExtractionValidationResult,
} from "./parameters/index.ts";

export {
  CANONICAL_DEFAULT_PERSONAS,
  CANONICAL_FEATURE_SCOPES,
  CANONICAL_PUBLIC_ROUTES,
  CANONICAL_AUTHENTICATED_ROUTES,
  extractFromWorkspace,
  validateParameters,
  resolveEndpoint,
  getPersonasForFeature,
  getPublicRoutes,
  getAuthenticatedRoutes,
  getDefaultParameters,
  ParameterExtractor,
  getDefaultParameterExtractor,
  setDefaultParameterExtractor,
  resetDefaultParameterExtractor,
} from "./parameters/index.ts";

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
} from "./identity/index.ts";

export {
  base64UrlEncode,
  base64UrlDecode,
  MOCK_JWT_SECRET,
  IdentityGovernanceEngine,
  getDefaultIdentityGovernanceEngine,
  setDefaultIdentityGovernanceEngine,
  resetDefaultIdentityGovernanceEngine,
} from "./identity/index.ts";
