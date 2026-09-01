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


describe("Evidence Lifecycle - Artifact Keys & Stability Barrier", () => {
describe("Composite-Key Artifact Identification Framework", () => {
      it("sanitizes key segments cleanly", () => {
        expect(CompositeKeyParser.sanitizeSegment("/users/settings/")).toBe("users-settings");
        expect(CompositeKeyParser.sanitizeSegment("Epic#1_Auth")).toBe("epic-1_auth");
        expect(CompositeKeyParser.sanitizeSegment("")).toBe("unknown");
      });

      it("serializes and parses composite artifact keys correctly", () => {
        const key: CompositeArtifactKey = {
          epic: "auth-gateway",
          round: 2,
          route: "login-form",
          state: "error-state",
          viewport: "1440x900",
        };

        const serializedWithExt = CompositeKeyParser.serialize(key, "png");
        expect(serializedWithExt).toBe("auth-gateway_r2_login-form_error-state_1440x900.png");

        const parsed = CompositeKeyParser.parse(serializedWithExt);
        expect(parsed.epic).toBe("auth-gateway");
        expect(parsed.round).toBe(2);
        expect(parsed.route).toBe("login-form");
        expect(parsed.state).toBe("error-state");
        expect(parsed.viewport).toBe("1440x900");
      });

      it("validates composite keys accurately", () => {
        expect(
          CompositeKeyParser.validate("checkout_r1_shipping_default_390x844.png"),
        ).toBe(true);
        expect(CompositeKeyParser.validate("invalid_key_too_few_parts")).toBe(false);
        expect(
          CompositeKeyParser.validate({
            epic: "auth",
            round: 1,
            route: "login",
            state: "default",
            viewport: "1440x900",
          }),
        ).toBe(true);
      });

      it("extracts complete artifact metadata", () => {
        const meta = CompositeKeyParser.extractMetadata(
          "dashboard_r1_overview_populated_1920x1080.png",
          {
            sizeBytes: 1048576,
            mimeType: "image/png",
          },
        );

        expect(meta.key.epic).toBe("dashboard");
        expect(meta.key.round).toBe(1);
        expect(meta.sizeBytes).toBe(1048576);
        expect(meta.mimeType).toBe("image/png");
        expect(meta.tier).toBe(1);
        expect(meta.sha256).toBeDefined();
        expect(meta.createdAt).toBeDefined();
      });

      it("throws HarnessError on invalid composite key operations", () => {
        expect(() => CompositeKeyParser.serialize(null as any)).toThrow(HarnessError);
        expect(() =>
          CompositeKeyParser.serialize({
            epic: "a",
            round: -1,
            route: "r",
            state: "s",
            viewport: "v",
          }),
        ).toThrow(HarnessError);
        expect(() => CompositeKeyParser.parse("")).toThrow(HarnessError);
        expect(() => CompositeKeyParser.parse("a_b_c_d")).toThrow(HarnessError);
      });
    });

    describe("Optical Stability Barrier", () => {
      it("evaluates 3-factor optical stability barrier and issues readiness tokens", () => {
        const barrier = new OpticalStabilityBarrier(500);
        const keyString = "dashboard_r1_overview_default_1440x900";

        const stableInput = {
          inFlightRequests: 0,
          networkQuiescenceDurationMs: 600,
          fontsReady: true,
          unrenderedAssetCount: 0,
          activeAnimationsCount: 0,
          layoutShiftDelta: 0.0001,
        };

        const stableRes = barrier.evaluateStability(keyString, stableInput);
        expect(stableRes.stable).toBe(true);
        expect(stableRes.readinessScore).toBe(1.0);
        expect(stableRes.readinessToken).toBeDefined();
        expect(stableRes.failureReasons.length).toBe(0);

        // Verify generated readiness token
        expect(barrier.verifyReadinessToken(stableRes.readinessToken!, keyString)).toBe(true);
        expect(barrier.verifyReadinessToken("ost_invalid_token", keyString)).toBe(false);
        expect(barrier.verifyReadinessToken(stableRes.readinessToken!, "different_key")).toBe(false);
      });

      it("rejects unstable state with multiple factor violations", () => {
        const barrier = new OpticalStabilityBarrier(500);
        const keyString = "modal_r1_dialog_open_768x1024";

        const unstableInput = {
          inFlightRequests: 3, // In-flight network!
          networkQuiescenceDurationMs: 100,
          fontsReady: false, // Fonts loading!
          unrenderedAssetCount: 2, // Assets pending!
          activeAnimationsCount: 1, // Transitions active!
          layoutShiftDelta: 0.02, // CLS delta high!
        };

        const unstableRes = barrier.evaluateStability(keyString, unstableInput);
        expect(unstableRes.stable).toBe(false);
        expect(unstableRes.readinessToken).toBeUndefined();
        expect(unstableRes.readinessScore).toBeLessThan(0.5);
        expect(unstableRes.failureReasons.length).toBeGreaterThanOrEqual(4);
      });

      it("throws HarnessError on invalid optical barrier inputs", () => {
        const barrier = new OpticalStabilityBarrier();
        expect(() => barrier.evaluateStability("key", null as any)).toThrow(HarnessError);
      });
    });
});
