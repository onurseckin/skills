import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
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
  base64UrlEncode,
  base64UrlDecode,
  MOCK_JWT_SECRET,
  detectSessionDegradation,
  executeAutonomousReauthentication,
  simulatePermissionBoundary,
  IdentityGovernanceEngine,
  getDefaultIdentityGovernanceEngine,
  setDefaultIdentityGovernanceEngine,
  resetDefaultIdentityGovernanceEngine,
  SYNTHETIC_FIXTURE_TYPES,
  computePayloadSha256,
  createDashboardTelemetryFixtures,
  createUserManagementFixtures,
  validatePayloadSchema,
  DataLayerPreFlightCertifier,
  DefectRouter,
  VisualFoundationHandoffGate,
  DisambiguationGatewayEngine,
  getDefaultDisambiguationGatewayEngine,
  setDefaultDisambiguationGatewayEngine,
  resetDefaultDisambiguationGatewayEngine,
  Z_INDEX_HIERARCHY,
  Z_INDEX_LAYER_RANGES,
  STANDARD_VIEWPORTS,
  TOUCH_HITBOX_MINIMUMS,
  CANONICAL_STRESS_INPUTS,
  JourneyFlowEngine,
  FormStressExplorer,
  OverlayOrchestrator,
  ResponsiveReflowProber,
  BrowserChoreographyEngine,
  getDefaultBrowserChoreographyEngine,
  setDefaultBrowserChoreographyEngine,
  resetDefaultBrowserChoreographyEngine,
  TARGET_FRAME_RATE,
  TARGET_FRAME_DURATION_MS,
  JANK_FRAME_THRESHOLD_MS,
  MAX_PERMISSIBLE_JANK_RATE,
  MAX_PERMISSIBLE_CLS,
  GPU_ACCELERATED_PROPERTIES,
  LAYOUT_TRIGGERING_PROPERTIES,
  SPRING_PRESETS,
  HeadlessMotionPreFlightAuditor,
  TemporalKeyframeStepSampler,
  MicrocraftInspector,
  MotionVerificationEngine,
  getDefaultMotionVerificationEngine,
  setDefaultMotionVerificationEngine,
  resetDefaultMotionVerificationEngine,
  CompositeKeyParser,
  OpticalStabilityBarrier,
  LifecycleManager,
  VisualDeltaComparator,
  EvidenceLifecycleEngine,
  getDefaultEvidenceLifecycleEngine,
  setDefaultEvidenceLifecycleEngine,
  resetDefaultEvidenceLifecycleEngine,
  PERMUTATION_THEMES,
  VIEWPORT_DIMENSIONS,
  THEME_PERMUTATION_GRID,
  PermutationGridManager,
  parseColorToRgb,
  calculateRelativeLuminance,
  calculateWcagContrastRatio,
  calculateApcaContrast,
  isWcagAaCompliant,
  isWcagAaaCompliant,
  isApcaCompliant,
  MathematicalContrastPreFilter,
  ThematicGateVerifier,
  detectThemeFlash,
  calibrateDarkDepth,
  validateHighContrastBoundaries,
  PermutationStagingEngine,
  getDefaultPermutationStagingEngine,
  setDefaultPermutationStagingEngine,
  resetDefaultPermutationStagingEngine,
  OPTICAL_DIMENSIONS,
  OPTICAL_DIMENSION_METADATA,
  ENTERPRISE_ACCOUNTING_PROFILE,
  LUXURY_HOSPITALITY_PROFILE,
  FLEET_TELEMATICS_PROFILE,
  STANDARD_AESTHETIC_PROFILES,
  AestheticProfileEvaluator,
  getDefaultAestheticProfileEvaluator,
  setDefaultAestheticProfileEvaluator,
  resetDefaultAestheticProfileEvaluator,
  SPACING_TOKENS,
  VALID_SPACING_VALUES,
  TYPOGRAPHY_TOKENS,
  VALID_FONT_SIZES,
  VALID_FONT_WEIGHTS,
  VALID_LINE_HEIGHTS,
  COLOR_PALETTES,
  SHADOW_ELEVATIONS,
  BORDER_RADII,
  VALID_BORDER_RADII_VALUES,
  TRANSITION_TOKENS,
  VALID_TRANSITION_DURATIONS,
  RawValuePolicyValidator,
  validateZeroRawValues,
  TokenComplianceImmunity,
  CompositionalDialecticEngine,
  TokenEvolutionManager,
  TokenAuthorityEngine,
  getDefaultTokenAuthorityEngine,
  setDefaultTokenAuthorityEngine,
  resetDefaultTokenAuthorityEngine,
  ROUND_SCOPES,
  DEFAULT_UNLOCK_TOKEN_EXPIRATION_MS,
  MIN_ROOT_CAUSE_ANALYSIS_LENGTH,
  canonicalJsonStringify,
  computeSha256,
  computeManifestSignature,
  requestOpticalRegressionUnlock,
  verifyRegressionProof,
  resealMilestone,
  verifyManifestIntegrity,
  verifyAllMilestoneLocks,
  assertIntegrity,
  MilestoneLockEngine,
  getDefaultMilestoneLockEngine,
  setDefaultMilestoneLockEngine,
  resetDefaultMilestoneLockEngine,
  MANDATORY_CHALLENGE_QUOTA_R1_R4,
  MAX_CONVERGENCE_CYCLES_PER_GATE,
  MIN_SUBSTANTIVE_DEFENSE_LENGTH,
  SOCRATIC_ROUNDS,
  SOCRATIC_ROUND_MAP,
  TRIVIAL_DEFENSE_PATTERNS,
  evaluateSubstantiveDefense,
  InterRoundRegressionAuditor,
  ParetoArbitrationEngine,
  raiseChallenge,
  submitDefense,
  escalateToParetoArbitration,
  evaluateRoundReadiness,
  auditInterRoundState,
  advanceRound,
  SocraticDialecticEngine,
  getDefaultSocraticDialecticEngine,
  setDefaultSocraticDialecticEngine,
  resetDefaultSocraticDialecticEngine,
  type EmpiricalRegressionProof,
  type UiDescriptor,
  type SyntheticFixture,
  type PayloadSchema,
  type CompositeArtifactKey,
  type JourneyFlow,
  type OverlayDescriptor,
  type TouchHitbox,
  type FormFieldDescriptor,
  type KeyframeSamplePoint,
  type MotionHeadlessPreFlightInput,
  type FocusRingMetrics,
  type HoverLiftMetrics,
} from "../fixtures.ts";

describe("Identity Governance Engine", () => {
  beforeEach(() => {
    resetDefaultIdentityGovernanceEngine();
  });

  afterEach(() => {
    resetDefaultIdentityGovernanceEngine();
  });

  describe("IdentityGovernanceEngine", () => {
    it("generates deterministic mock JWT tokens with correct claims", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.admin!;

      const token = engine.generateMockToken(persona, { expiresInSeconds: 1800 });
      expect(token).toBeDefined();
      expect(token.split(".").length).toBe(3);

      const decoded = engine.decodeMockToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.payload.role).toBe("admin");
      expect(decoded?.payload.email).toBe(persona.email);
      expect(decoded?.payload.tenant_id).toBe(persona.tenantId);
      expect(decoded?.payload.iss).toBe("olt-identity-governor");
      expect(typeof decoded?.payload.exp).toBe("number");
    });

    it("detects expired tokens accurately", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.standard_user!;

      // Token expiring in 100 seconds
      const activeToken = engine.generateMockToken(persona, { expiresInSeconds: 100 });
      expect(engine.isTokenExpired(activeToken)).toBe(false);

      // Token that expired in past
      const expiredToken = engine.generateMockToken(persona, { expiresInSeconds: -50 });
      expect(engine.isTokenExpired(expiredToken)).toBe(true);
    });

    it("generates session cookies conforming to template specifications", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.admin!;

      const cookies = engine.generateSessionCookies(persona, {
        baseUrl: "http://localhost:3000",
      });

      expect(cookies.length).toBe(2);
      const sessionCookie = cookies.find((c) => c.name === "olt_session_id");
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie?.domain).toBe("localhost");
      expect(sessionCookie?.httpOnly).toBe(true);
      expect(sessionCookie?.sameSite).toBe("Lax");
    });

    it("generates Playwright-compatible browser storage state", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.billing_admin!;

      const storageState = engine.generateStorageState(persona, {
        baseUrl: "http://localhost:3000",
      });

      expect(storageState.cookies.length).toBeGreaterThan(0);
      expect(storageState.origins.length).toBe(1);
      expect(storageState.origins[0]?.origin).toBe("http://localhost:3000");

      const authStorage = storageState.origins[0]?.localStorage.find(
        (e) => e.name === "auth_token",
      );
      expect(authStorage).toBeDefined();
      expect(authStorage?.value).toBeDefined();

      const userStorage = storageState.origins[0]?.localStorage.find(
        (e) => e.name === "current_user",
      );
      expect(userStorage).toBeDefined();
      const parsedUser = JSON.parse(userStorage!.value);
      expect(parsedUser.role).toBe("billing_admin");
    });

    it("generates HTTP authorization headers", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.compliance_auditor!;

      const headers = engine.generateAuthHeaders(persona);
      expect(headers.Authorization).toMatch(/^Bearer\s+.+/u);
      expect(headers["X-Tenant-ID"]).toBe(persona.tenantId);
      expect(headers["X-User-Role"]).toBe("compliance_auditor");
    });

    it("creates complete persona session context", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.admin!;

      const ctx = engine.createPersonaSessionContext(persona, { baseUrl: "http://localhost:3000" });
      expect(ctx.persona).toEqual(persona);
      expect(ctx.token).toBeDefined();
      expect(ctx.cookies.length).toBe(2);
      expect(ctx.authHeaders.Authorization).toBeDefined();
      expect(ctx.storageState.origins.length).toBe(1);
      expect(ctx.expiresAt).toBeGreaterThan(Date.now());
    });

    it("detects mid-flight session degradation across all vectors", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.standard_user!;

      // 1. HTTP 401
      const res401 = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/dashboard",
        statusCode: 401,
        activePersona: persona,
      });
      expect(res401.degraded).toBe(true);
      expect(res401.cause).toBe("STATUS_401");
      expect(res401.recommendedAction).toBe("RE_AUTHENTICATE");

      // 2. HTTP 403
      const res403 = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/admin",
        statusCode: 403,
        activePersona: persona,
      });
      expect(res403.degraded).toBe(true);
      expect(res403.cause).toBe("STATUS_403");
      expect(res403.recommendedAction).toBe("SWITCH_PERSONA");

      // 3. HTTP 419
      const res419 = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/settings",
        statusCode: 419,
        activePersona: persona,
      });
      expect(res419.degraded).toBe(true);
      expect(res419.cause).toBe("STATUS_419");

      // 4. Redirect to login
      const resRedirect = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/login?redirect=%2Fdashboard",
        activePersona: persona,
      });
      expect(resRedirect.degraded).toBe(true);
      expect(resRedirect.cause).toBe("REDIRECT_TO_LOGIN");

      // 5. Visual unauthorized banner
      const resVisual = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/profile",
        domSnippet: "<div class='banner alert'>Your session expired. Please log in again.</div>",
        activePersona: persona,
      });
      expect(resVisual.degraded).toBe(true);
      expect(resVisual.cause).toBe("VISUAL_UNAUTHORIZED_BANNER");

      // 6. Expired JWT
      const expiredJwt = engine.generateMockToken(persona, { expiresInSeconds: -100 });
      const resExpiredJwt = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/dashboard",
        token: expiredJwt,
        activePersona: persona,
      });
      expect(resExpiredJwt.degraded).toBe(true);
      expect(resExpiredJwt.cause).toBe("EXPIRED_JWT");

      // 7. Clean active session
      const validJwt = engine.generateMockToken(persona, { expiresInSeconds: 3600 });
      const resClean = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/dashboard",
        statusCode: 200,
        token: validJwt,
        activePersona: persona,
      });
      expect(resClean.degraded).toBe(false);
      expect(resClean.cause).toBe("NONE");
    });

    it("executes autonomous re-authentication protocol gracefully", () => {
      const engine = new IdentityGovernanceEngine();
      const persona = CANONICAL_DEFAULT_PERSONAS.standard_user!;

      const degradation = engine.detectSessionDegradation({
        currentUrl: "http://localhost:3000/dashboard",
        statusCode: 401,
        activePersona: persona,
      });

      const reauthPlan = engine.executeAutonomousReauthentication(degradation, persona, {
        baseUrl: "http://localhost:3000",
        resumeUrl: "http://localhost:3000/dashboard",
      });

      expect(reauthPlan.success).toBe(true);
      expect(reauthPlan.resumeUrl).toBe("http://localhost:3000/dashboard");
      expect(reauthPlan.freshContext.token).toBeDefined();
      expect(reauthPlan.injectionSteps.length).toBeGreaterThan(3);
    });

    it("simulates multi-role permission boundaries and catches privilege leakage", () => {
      const engine = new IdentityGovernanceEngine();
      const personas = [
        CANONICAL_DEFAULT_PERSONAS.admin!,
        CANONICAL_DEFAULT_PERSONAS.standard_user!,
        CANONICAL_DEFAULT_PERSONAS.guest!,
      ];

      // Standard admin-only route
      const auditResult = engine.simulatePermissionBoundary("/admin/settings", ["*"], personas);

      expect(auditResult.compliant).toBe(true);
      expect(auditResult.securityScore).toBe(100);
      expect(auditResult.privilegeLeakages.length).toBe(0);

      const adminEval = auditResult.evaluations.find((e) => e.role === "admin");
      expect(adminEval?.actualResult).toBe("ALLOW");

      const standardEval = auditResult.evaluations.find((e) => e.role === "standard_user");
      expect(standardEval?.actualResult).toBe("DENY_FORBIDDEN");

      const guestEval = auditResult.evaluations.find((e) => e.role === "guest");
      expect(guestEval?.actualResult).toBe("DENY_REDIRECT_LOGIN");
    });

    it("manages singleton instance correctly", () => {
      const defaultEngine = getDefaultIdentityGovernanceEngine();
      expect(defaultEngine).toBeInstanceOf(IdentityGovernanceEngine);

      const customEngine = new IdentityGovernanceEngine();
      setDefaultIdentityGovernanceEngine(customEngine);
      expect(getDefaultIdentityGovernanceEngine()).toBe(customEngine);
    });
  });

  // =========================================================================
  // 4. Data Layer Disambiguation Gateway Tests
  // =========================================================================
});
