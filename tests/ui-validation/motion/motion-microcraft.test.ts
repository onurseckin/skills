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

describe("Motion Verification - Microcraft & Physics Inspection", () => {
  beforeEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  afterEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  describe("Microcraft & Tactile Feedback Inspection", () => {
    it("inspects focus rings for width, offset, contrast, and crispness", () => {
      const inspector = new MicrocraftInspector();
      const validRing: FocusRingMetrics = {
        selector: "button.primary",
        outlineWidthPx: 2,
        outlineStyle: "solid",
        outlineColor: "#3b82f6",
        outlineOffsetPx: 2,
        contrastRatioWithBackground: 4.5,
        isCrisp: true,
      };

      const passRes = inspector.inspectFocusRing(validRing);
      expect(passRes.passed).toBe(true);
      expect(passRes.violations.length).toBe(0);

      const badRing: FocusRingMetrics = {
        selector: "button.subtle",
        outlineWidthPx: 1, // < 2px
        outlineStyle: "none",
        outlineColor: "#ccc",
        outlineOffsetPx: 0, // < 1px
        contrastRatioWithBackground: 1.5, // < 3.0:1
        isCrisp: false,
      };

      const failRes = inspector.inspectFocusRing(badRing);
      expect(failRes.passed).toBe(false);
      expect(failRes.violations.length).toBe(5);
    });

    it("inspects hover lift tactile feedback (translateY and shadow depth)", () => {
      const inspector = new MicrocraftInspector();
      const validHover: HoverLiftMetrics = {
        selector: ".card-interactive",
        defaultTransform: "translateY(0px)",
        hoverTransform: "translateY(-2px)",
        defaultBoxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        hoverBoxShadow: "0 4px 6px rgba(0,0,0,0.15)",
        translateYPx: -2,
        shadowDepthChange: 3,
      };

      const passRes = inspector.inspectHoverLift(validHover);
      expect(passRes.passed).toBe(true);

      const badHover: HoverLiftMetrics = {
        selector: ".card-flat",
        defaultTransform: "translateY(0px)",
        hoverTransform: "translateY(5px)", // Downwards instead of lift
        defaultBoxShadow: "none",
        hoverBoxShadow: "none",
        translateYPx: 5,
        shadowDepthChange: 0,
      };

      const failRes = inspector.inspectHoverLift(badHover);
      expect(failRes.passed).toBe(false);
      expect(failRes.violations.length).toBe(2);
    });

    it("detects motion jitter and direction reversals", () => {
      const inspector = new MicrocraftInspector();
      const smoothSamples = [
        { timeMs: 0, value: 0 },
        { timeMs: 50, value: 0.2 },
        { timeMs: 100, value: 0.6 },
        { timeMs: 150, value: 0.9 },
        { timeMs: 200, value: 1.0 },
      ];
      expect(inspector.detectMotionJitter(smoothSamples).hasJitter).toBe(false);

      const noisySamples = [
        { timeMs: 0, value: 0 },
        { timeMs: 20, value: 0.4 },
        { timeMs: 40, value: 0.2 }, // Reverse 1
        { timeMs: 60, value: 0.6 }, // Reverse 2
        { timeMs: 80, value: 0.4 }, // Reverse 3
        { timeMs: 100, value: 0.8 }, // Reverse 4
        { timeMs: 120, value: 0.6 }, // Reverse 5
        { timeMs: 140, value: 1.0 },
      ];
      expect(inspector.detectMotionJitter(noisySamples).hasJitter).toBe(true);
    });

    it("inspects spring physics presets and enforces cockpit zero-overshoot constraint", () => {
      const inspector = new MicrocraftInspector();
      expect(SPRING_PRESETS.COCKPIT.name).toBe("cockpit");
      expect(SPRING_PRESETS.GENTLE.stiffness).toBe(120);

      const cockpitSmoothSamples = [
        { timeMs: 0, value: 0 },
        { timeMs: 50, value: 0.5 },
        { timeMs: 100, value: 0.8 },
        { timeMs: 150, value: 0.95 },
        { timeMs: 200, value: 1.0 },
      ];

      const cockpitPass = inspector.inspectSpringPhysics({
        presetName: "cockpit",
        trajectorySamples: cockpitSmoothSamples,
        targetValue: 1.0,
      });
      expect(cockpitPass.passed).toBe(true);
      expect(cockpitPass.maxOvershoot).toBe(0);

      const cockpitOvershootSamples = [
        { timeMs: 0, value: 0 },
        { timeMs: 80, value: 1.2 }, // 20% overshoot!
        { timeMs: 150, value: 0.95 },
        { timeMs: 200, value: 1.0 },
      ];

      const cockpitFail = inspector.inspectSpringPhysics({
        presetName: "cockpit",
        trajectorySamples: cockpitOvershootSamples,
        targetValue: 1.0,
      });
      expect(cockpitFail.passed).toBe(false);
      expect(
        cockpitFail.violations.some((v) =>
          v.includes("Cockpit spring preset mandates zero overshoot"),
        ),
      ).toBe(true);
    });

    it("throws HarnessError on invalid microcraft inputs", () => {
      const inspector = new MicrocraftInspector();
      expect(() => inspector.inspectFocusRing(null as any)).toThrow(HarnessError);
      expect(() => inspector.inspectHoverLift(null as any)).toThrow(HarnessError);
      expect(() => inspector.inspectSpringPhysics(null as any)).toThrow(HarnessError);
    });
  });

  describe("MotionVerificationEngine Singleton", () => {
    it("manages singleton instance getters, setters, and resetters", () => {
      const engine1 = getDefaultMotionVerificationEngine();
      const engine2 = getDefaultMotionVerificationEngine();
      expect(engine1).toBe(engine2);

      const custom = new MotionVerificationEngine();
      setDefaultMotionVerificationEngine(custom);
      expect(getDefaultMotionVerificationEngine()).toBe(custom);

      resetDefaultMotionVerificationEngine();
      const fresh = getDefaultMotionVerificationEngine();
      expect(fresh).not.toBe(custom);
    });
  });
});

// =========================================================================
// 3. Evidence Lifecycle Engine Tests
// =========================================================================
