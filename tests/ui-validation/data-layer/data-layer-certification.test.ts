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
} from "../fixtures.ts";


describe("Data Layer Disambiguation Gateway - Pre-flight & Handoff Token", () => {
  beforeEach(() => {
    resetDefaultDisambiguationGatewayEngine();
  });

  afterEach(() => {
    resetDefaultDisambiguationGatewayEngine();
  });

  describe("Certification & Token Gate", () => {
it("certifies valid data-layer responses in pre-flight inspection", () => {
      const certifier = new DataLayerPreFlightCertifier();
      const fixtures = createDashboardTelemetryFixtures();

      const result = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 200,
        actualPayload: fixtures.FULLY_POPULATED.payload,
        latencyMs: 45,
      });

      expect(result.certified).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.certificateId).toMatch(/^cert-/u);
      expect(result.latencyMs).toBe(45);
    });

    it("rejects invalid status code or high latency in pre-flight certification", () => {
      const certifier = new DataLayerPreFlightCertifier();
      const fixtures = createDashboardTelemetryFixtures();

      // Unexpected 500 error when expecting 200
      const statusMismatch = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 500,
        actualPayload: { error: "Database crashed" },
        latencyMs: 120,
      });

      expect(statusMismatch.certified).toBe(false);
      expect(statusMismatch.violations.some((v) => v.includes("HTTP Status Code mismatch"))).toBe(true);

      // Latency exceeded
      const highLatency = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 200,
        actualPayload: fixtures.FULLY_POPULATED.payload,
        latencyMs: 6500,
        maxLatencyMs: 5000,
      });

      expect(highLatency.certified).toBe(false);
      expect(highLatency.violations.some((v) => v.includes("latency"))).toBe(true);
    });

    it("routes data-layer defects directly to AUTONOMOUS_REPAIRER", () => {
      const certifier = new DataLayerPreFlightCertifier();
      const defectRouter = new DefectRouter();
      const fixtures = createDashboardTelemetryFixtures();

      const failedCert = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 500,
        actualPayload: { error: "Internal Server Error" },
        latencyMs: 100,
      });

      const receipt = defectRouter.routeDefect(failedCert, { error: "Internal Server Error" });

      expect(receipt.recipient).toBe("AUTONOMOUS_REPAIRER");
      expect(receipt.category).toBe("BACKEND_DATA_LAYER_FAULT");
      expect(receipt.severity).toBe("CRITICAL");
      expect(receipt.endpoint).toBe("/api/telemetry");
      expect(receipt.statusCode).toBe(500);

      expect(defectRouter.getRoutedReceipts().length).toBe(1);
      defectRouter.clearReceipts();
      expect(defectRouter.getRoutedReceipts().length).toBe(0);
    });

    it("issues and verifies cryptographic visual foundation handoff tokens", () => {
      const certifier = new DataLayerPreFlightCertifier();
      const handoffGate = new VisualFoundationHandoffGate();
      const fixtures = createDashboardTelemetryFixtures();
      const payload = fixtures.FULLY_POPULATED.payload;

      const cert = certifier.certifyFixture({
        endpoint: "/api/telemetry",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 200,
        actualPayload: payload,
        latencyMs: 25,
      });

      // Issue token
      const token = handoffGate.issueHandoffToken(cert, payload, {
        componentOrRoute: "/dashboard",
        ttlSeconds: 600,
      });

      expect(token.tokenId).toMatch(/^vtok-/u);
      expect(token.certificateId).toBe(cert.certificateId);
      expect(token.componentOrRoute).toBe("/dashboard");
      expect(token.payloadSha256).toBe(computePayloadSha256(payload));

      // Verify authentic token and payload
      const validVerify = handoffGate.verifyHandoffToken(token, payload);
      expect(validVerify.verified).toBe(true);
      expect(validVerify.tampered).toBe(false);
      expect(validVerify.expired).toBe(false);

      // Tampered payload detection
      const tamperedPayload = { ...(payload as Record<string, unknown>), injectedField: "hacked" };
      const tamperedVerify = handoffGate.verifyHandoffToken(token, tamperedPayload);
      expect(tamperedVerify.verified).toBe(false);
      expect(tamperedVerify.tampered).toBe(true);

      // Expired token detection
      const expiredVerify = handoffGate.verifyHandoffToken(token, payload, token.expiresAt + 10);
      expect(expiredVerify.verified).toBe(false);
      expect(expiredVerify.expired).toBe(true);
    });

    it("throws HarnessError when trying to issue handoff token for uncertified pre-flight result", () => {
      const handoffGate = new VisualFoundationHandoffGate();
      const uncertifiedResult = {
        certified: false,
        certificateId: "cert-invalid",
        endpoint: "/api/broken",
        fixtureType: "FULLY_POPULATED" as const,
        statusCode: 500,
        expectedStatusCode: 200,
        schemaValid: false,
        latencyMs: 50,
        violations: ["Server crashed"],
        timestamp: new Date().toISOString(),
      };

      expect(() => {
        handoffGate.issueHandoffToken(uncertifiedResult, {}, { componentOrRoute: "/broken" });
      }).toThrow(HarnessError);
    });

    it("executes end-to-end evaluation flow in DisambiguationGatewayEngine", () => {
      const engine = new DisambiguationGatewayEngine();
      const fixtures = createDashboardTelemetryFixtures();

      // Success path
      const successEval = engine.processDataLayerEvaluation({
        endpoint: "/api/telemetry",
        componentOrRoute: "/dashboard",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 200,
        actualPayload: fixtures.FULLY_POPULATED.payload,
        latencyMs: 30,
      });

      expect(successEval.certification.certified).toBe(true);
      expect(successEval.handoffToken).toBeDefined();
      expect(successEval.defectReceipt).toBeUndefined();

      // Failure path -> auto routes to AUTONOMOUS_REPAIRER
      const failEval = engine.processDataLayerEvaluation({
        endpoint: "/api/telemetry",
        componentOrRoute: "/dashboard",
        fixture: fixtures.FULLY_POPULATED,
        actualStatusCode: 500,
        actualPayload: { error: "Database timeout" },
        latencyMs: 500,
      });

      expect(failEval.certification.certified).toBe(false);
      expect(failEval.handoffToken).toBeUndefined();
      expect(failEval.defectReceipt).toBeDefined();
      expect(failEval.defectReceipt?.recipient).toBe("AUTONOMOUS_REPAIRER");
    });

    it("manages singleton instance correctly", () => {
      const defaultEngine = getDefaultDisambiguationGatewayEngine();
      expect(defaultEngine).toBeInstanceOf(DisambiguationGatewayEngine);

      const customEngine = new DisambiguationGatewayEngine();
      setDefaultDisambiguationGatewayEngine(customEngine);
      expect(getDefaultDisambiguationGatewayEngine()).toBe(customEngine);
    });
  });
  });
