import {
  afterEach, beforeEach, describe, expect, it, HarnessError,
  OPTICAL_QUARANTINE_INVARIANTS, PERMITTED_IMAGE_EXTENSIONS, FORBIDDEN_SOURCE_EXTENSIONS,
  AUTHORIZED_BROWSER_TOOLS, AUTHORIZED_VISUAL_TOOLS, AUTHORIZED_MESSAGING_TOOLS, FORBIDDEN_TOOLS,
  EVALUATE_SCRIPT_HOST_FS_PATTERNS, SHELL_INJECTION_PATTERNS, LOCAL_URL_BYPASS_PATTERNS,
  isOpticalValidatorRole, verifyCapability, detectBackdoorBypass, ToolQuarantineEngine,
  getDefaultQuarantineEngine, setDefaultQuarantineEngine, resetDefaultQuarantineEngine,
  CANONICAL_DEFAULT_PERSONAS, CANONICAL_FEATURE_SCOPES, CANONICAL_PUBLIC_ROUTES,
  CANONICAL_AUTHENTICATED_ROUTES, extractFromWorkspace, validateParameters, resolveEndpoint,
  getPersonasForFeature, getPublicRoutes, getAuthenticatedRoutes, getDefaultParameters,
  ParameterExtractor, getDefaultParameterExtractor, setDefaultParameterExtractor, resetDefaultParameterExtractor,
  base64UrlEncode, base64UrlDecode, MOCK_JWT_SECRET, detectSessionDegradation, executeAutonomousReauthentication,
  simulatePermissionBoundary, IdentityGovernanceEngine, getDefaultIdentityGovernanceEngine,
  setDefaultIdentityGovernanceEngine, resetDefaultIdentityGovernanceEngine, SYNTHETIC_FIXTURE_TYPES,
  computePayloadSha256, createDashboardTelemetryFixtures, createUserManagementFixtures,
  validatePayloadSchema, DataLayerPreFlightCertifier, DefectRouter, VisualFoundationHandoffGate,
  DisambiguationGatewayEngine, getDefaultDisambiguationGatewayEngine, setDefaultDisambiguationGatewayEngine,
  resetDefaultDisambiguationGatewayEngine, Z_INDEX_HIERARCHY, Z_INDEX_LAYER_RANGES, STANDARD_VIEWPORTS,
  TOUCH_HITBOX_MINIMUMS, CANONICAL_STRESS_INPUTS, JourneyFlowEngine, FormStressExplorer,
  OverlayOrchestrator, ResponsiveReflowProber, BrowserChoreographyEngine, getDefaultBrowserChoreographyEngine,
  setDefaultBrowserChoreographyEngine, resetDefaultBrowserChoreographyEngine, TARGET_FRAME_RATE,
  TARGET_FRAME_DURATION_MS, JANK_FRAME_THRESHOLD_MS, MAX_PERMISSIBLE_JANK_RATE, MAX_PERMISSIBLE_CLS,
  GPU_ACCELERATED_PROPERTIES, LAYOUT_TRIGGERING_PROPERTIES, SPRING_PRESETS, HeadlessMotionPreFlightAuditor,
  TemporalKeyframeStepSampler, MicrocraftInspector, MotionVerificationEngine, getDefaultMotionVerificationEngine,
  setDefaultMotionVerificationEngine, resetDefaultMotionVerificationEngine, CompositeKeyParser,
  OpticalStabilityBarrier, LifecycleManager, VisualDeltaComparator, EvidenceLifecycleEngine,
  getDefaultEvidenceLifecycleEngine, setDefaultEvidenceLifecycleEngine, resetDefaultEvidenceLifecycleEngine,
  PERMUTATION_THEMES, VIEWPORT_DIMENSIONS, THEME_PERMUTATION_GRID, PermutationGridManager, parseColorToRgb,
  calculateRelativeLuminance, calculateWcagContrastRatio, calculateApcaContrast, isWcagAaCompliant,
  isWcagAaaCompliant, isApcaCompliant, MathematicalContrastPreFilter, ThematicGateVerifier, detectThemeFlash,
  calibrateDarkDepth, validateHighContrastBoundaries, PermutationStagingEngine, getDefaultPermutationStagingEngine,
  setDefaultPermutationStagingEngine, resetDefaultPermutationStagingEngine, OPTICAL_DIMENSIONS,
  OPTICAL_DIMENSION_METADATA, ENTERPRISE_ACCOUNTING_PROFILE, LUXURY_HOSPITALITY_PROFILE,
  FLEET_TELEMATICS_PROFILE, STANDARD_AESTHETIC_PROFILES, AestheticProfileEvaluator,
  getDefaultAestheticProfileEvaluator, setDefaultAestheticProfileEvaluator, resetDefaultAestheticProfileEvaluator,
  SPACING_TOKENS, VALID_SPACING_VALUES, TYPOGRAPHY_TOKENS, VALID_FONT_SIZES, VALID_FONT_WEIGHTS,
  VALID_LINE_HEIGHTS, COLOR_PALETTES, SHADOW_ELEVATIONS, BORDER_RADII, VALID_BORDER_RADII_VALUES,
  TRANSITION_TOKENS, VALID_TRANSITION_DURATIONS, RawValuePolicyValidator, validateZeroRawValues,
  TokenComplianceImmunity, CompositionalDialecticEngine, TokenEvolutionManager, TokenAuthorityEngine,
  getDefaultTokenAuthorityEngine, setDefaultTokenAuthorityEngine, resetDefaultTokenAuthorityEngine,
  ROUND_SCOPES, DEFAULT_UNLOCK_TOKEN_EXPIRATION_MS, MIN_ROOT_CAUSE_ANALYSIS_LENGTH,
  canonicalJsonStringify, computeSha256, computeManifestSignature, requestOpticalRegressionUnlock,
  verifyRegressionProof, resealMilestone, verifyManifestIntegrity, verifyAllMilestoneLocks,
  assertIntegrity, MilestoneLockEngine, getDefaultMilestoneLockEngine, setDefaultMilestoneLockEngine,
  resetDefaultMilestoneLockEngine, MANDATORY_CHALLENGE_QUOTA_R1_R4, MAX_CONVERGENCE_CYCLES_PER_GATE,
  MIN_SUBSTANTIVE_DEFENSE_LENGTH, SOCRATIC_ROUNDS, SOCRATIC_ROUND_MAP, TRIVIAL_DEFENSE_PATTERNS,
  evaluateSubstantiveDefense, InterRoundRegressionAuditor, ParetoArbitrationEngine, raiseChallenge,
  submitDefense, escalateToParetoArbitration, evaluateRoundReadiness, auditInterRoundState, advanceRound,
  SocraticDialecticEngine, getDefaultSocraticDialecticEngine, setDefaultSocraticDialecticEngine,
  resetDefaultSocraticDialecticEngine, type EmpiricalRegressionProof, type UiDescriptor,
  type SyntheticFixture, type PayloadSchema, type CompositeArtifactKey, type JourneyFlow,
  type OverlayDescriptor, type TouchHitbox, type FormFieldDescriptor, type KeyframeSamplePoint,
  type MotionHeadlessPreFlightInput, type FocusRingMetrics, type HoverLiftMetrics,
} from "./fixtures.ts";


describe("Parameter Extractor", () => {
  beforeEach(() => {
    resetDefaultParameterExtractor();
  });

  afterEach(() => {
    resetDefaultParameterExtractor();
  });

describe("ParameterExtractor", () => {
    it("extracts parameters from canonical default policy configuration", () => {
      const extractor = new ParameterExtractor();
      const defaultParams = extractor.getDefaultParameters("http://localhost:3000");

      expect(defaultParams.endpoints.baseUrl).toBe("http://localhost:3000");
      expect(defaultParams.endpoints.port).toBe(3000);
      expect(defaultParams.endpoints.healthEndpoint).toBe("http://localhost:3000/api/health");
      expect(defaultParams.endpoints.loginUrl).toBe("http://localhost:3000/login");
      expect(defaultParams.endpoints.sessionVerifyUrl).toBe("http://localhost:3000/api/auth/me");
      expect(defaultParams.endpoints.publicRoutes).toEqual(CANONICAL_PUBLIC_ROUTES);
      expect(defaultParams.endpoints.authenticatedRoutes).toEqual(CANONICAL_AUTHENTICATED_ROUTES);

      expect(defaultParams.personas.admin).toBeDefined();
      expect(defaultParams.personas.admin?.role).toBe("admin");
      expect(defaultParams.personas.admin?.permissions).toContain("*");

      expect(defaultParams.personas.standard_user).toBeDefined();
      expect(defaultParams.personas.standard_user?.role).toBe("standard_user");

      expect(defaultParams.personas.guest).toBeDefined();
      expect(defaultParams.personas.guest?.role).toBe("guest");

      expect(defaultParams.featureScopes.length).toBeGreaterThan(0);
    });

    it("extracts parameters from custom policy structure", () => {
      const extractor = new ParameterExtractor();
      const mockPolicy = {
        schema_version: 1,
        ecosystem: "bun",
        docker_environment: {
          enabled: true,
          compose_file: "docker-compose.custom.yml",
          containers: {
            web_app: {
              container_name: "custom-web-app",
              ports: ["8080:8080"],
              health_endpoint: "http://localhost:8080/healthz",
              ready_timeout_ms: 15000,
            },
          },
          auth_paths: {
            login_url: "http://localhost:8080/auth/signin",
            logout_url: "http://localhost:8080/auth/signout",
            signup_url: "http://localhost:8080/auth/register",
            session_verify_url: "http://localhost:8080/api/session",
          },
          test_user_personas: {
            admin: {
              role: "admin",
              email: "superadmin@custom.local",
              display_name: "Super Administrator",
              tenant_id: "tenant-custom-99",
              permissions: ["*"],
            },
          },
        },
      };

      const extracted = extractor.extractFromPolicy(mockPolicy);
      expect(extracted.endpoints.port).toBe(8080);
      expect(extracted.endpoints.baseUrl).toBe("http://localhost:8080");
      expect(extracted.endpoints.healthEndpoint).toBe("http://localhost:8080/healthz");
      expect(extracted.endpoints.loginUrl).toBe("http://localhost:8080/auth/signin");
      expect(extracted.endpoints.logoutUrl).toBe("http://localhost:8080/auth/signout");
      expect(extracted.endpoints.signupUrl).toBe("http://localhost:8080/auth/register");
      expect(extracted.endpoints.sessionVerifyUrl).toBe("http://localhost:8080/api/session");
      expect(extracted.portInfo.containerName).toBe("custom-web-app");
      expect(extracted.personas.admin?.email).toBe("superadmin@custom.local");
      expect(extracted.personas.admin?.tenantId).toBe("tenant-custom-99");
    });

    it("resolves relative routes to absolute endpoint URLs", () => {
      const extractor = new ParameterExtractor();
      const params = extractor.getDefaultParameters("http://localhost:4000");

      expect(extractor.resolveEndpoint("/dashboard", params)).toBe("http://localhost:4000/dashboard");
      expect(extractor.resolveEndpoint("settings/profile", params)).toBe("http://localhost:4000/settings/profile");
      expect(extractor.resolveEndpoint("http://otherhost:8080/external", params)).toBe("http://otherhost:8080/external");
    });

    it("filters personas for specific feature scopes", () => {
      const extractor = new ParameterExtractor();
      const params = extractor.getDefaultParameters();

      const adminPersonas = extractor.getPersonasForFeature("administration", params);
      expect(adminPersonas.map((p) => p.role)).toContain("admin");
      expect(adminPersonas.map((p) => p.role)).not.toContain("standard_user");

      const authPersonas = extractor.getPersonasForFeature("authentication", params);
      expect(authPersonas.map((p) => p.role)).toContain("guest");
      expect(authPersonas.map((p) => p.role)).toContain("standard_user");
    });

    it("validates parameters and reports errors for broken configurations", () => {
      const extractor = new ParameterExtractor();
      const brokenParams = {
        ...extractor.getDefaultParameters(),
        endpoints: {
          ...extractor.getDefaultParameters().endpoints,
          baseUrl: "invalid-url",
          port: -1,
          healthEndpoint: "not-a-url",
        },
        personas: {},
      };

      const validation = extractor.validateParameters(brokenParams);
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some((e) => e.includes("baseUrl"))).toBe(true);
      expect(validation.errors.some((e) => e.includes("port"))).toBe(true);
      expect(validation.errors.some((e) => e.includes("personas"))).toBe(true);
    });

    it("extracts parameters from workspace policy file if present", () => {
      const extractor = new ParameterExtractor();
      const params = extractor.extractFromWorkspace();
      expect(params).toBeDefined();
      expect(params.endpoints.baseUrl).toBeDefined();
      expect(params.personas.admin).toBeDefined();
    });

    it("manages singleton instance correctly", () => {
      const defaultExtractor = getDefaultParameterExtractor();
      expect(defaultExtractor).toBeInstanceOf(ParameterExtractor);

      const customExtractor = new ParameterExtractor();
      setDefaultParameterExtractor(customExtractor);
      expect(getDefaultParameterExtractor()).toBe(customExtractor);
    });
  });

  // =========================================================================
  // 3. Identity Governance Engine Tests
  // =========================================================================
});
