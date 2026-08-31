export {
  MANDATORY_VIEWPORT_TIERS,
  RESPONSIVE_4TIER_SPECS,
  assert4TierViewportCoverage,
  evaluateViewportCoverage,
  getCanonical4TierCaptureViewports,
  getResponsiveViewportMatrix,
  getViewportSpecByTier,
  matchViewportTier,
  toCanonicalCaptureViewport,
} from "./viewport-matrix.ts";

export {
  DEFAULT_COOKIE_TEMPLATE,
  MANDATORY_PERSONA_ROLES,
  extractCaptureAuthFromPolicy,
  generateMockSessionCookies,
  getAllUserPersonas,
  getUserPersona,
  isUserPersonaRole,
  mapPolicyPersonaToCaptureUser,
  syncPersonasWithDockerPolicy,
  validatePersonaGovernance,
} from "./persona-governance.ts";

export {
  assertCaptureGovernanceCompliance,
  auditCaptureGovernance,
  synchronizeCaptureGovernance,
} from "./governance-sync.ts";

export type {
  CaptureAuthConfig,
  CaptureCookie,
  CaptureGovernanceReport,
  CaptureUserConfig,
  CaptureViewport,
  CookieTemplateConfig,
  GovernanceSyncOptions,
  PersonaGovernanceRecord,
  PersonaGovernanceSyncResult,
  RepoPolicy,
  ResponsiveViewportSpec,
  ResponsiveViewportTier,
  UserPersonaConfig,
  UserPersonaRole,
  ViewportGovernanceSyncResult,
} from "./types.ts";
