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


describe("Motion Verification - Headless Pre-flight & Keyframe Sampler", () => {
  beforeEach(() => {
    resetDefaultMotionVerificationEngine();
  });

  afterEach(() => {
    resetDefaultMotionVerificationEngine();
  });

describe("Phase 1: Quantitative Motion Headless Pre-flight", () => {
      it("verifies frame rate constants and property classifications", () => {
        expect(TARGET_FRAME_RATE).toBe(60);
        expect(TARGET_FRAME_DURATION_MS).toBeCloseTo(16.67, 1);
        expect(MAX_PERMISSIBLE_JANK_RATE).toBe(0.05);
        expect(MAX_PERMISSIBLE_CLS).toBe(0.01);

        expect(GPU_ACCELERATED_PROPERTIES).toContain("transform");
        expect(GPU_ACCELERATED_PROPERTIES).toContain("opacity");
        expect(LAYOUT_TRIGGERING_PROPERTIES).toContain("width");
        expect(LAYOUT_TRIGGERING_PROPERTIES).toContain("height");
        expect(LAYOUT_TRIGGERING_PROPERTIES).toContain("top");
      });

      it("audits animated properties for GPU acceleration vs layout triggers", () => {
        const auditor = new HeadlessMotionPreFlightAuditor();
        const audits = auditor.auditProperties(["transform", "opacity", "width", "top"]);

        expect(audits[0].isGpuAccelerated).toBe(true);
        expect(audits[0].isLayoutTriggering).toBe(false);

        expect(audits[1].isGpuAccelerated).toBe(true);
        expect(audits[1].isLayoutTriggering).toBe(false);

        expect(audits[2].isGpuAccelerated).toBe(false);
        expect(audits[2].isLayoutTriggering).toBe(true);
        expect(audits[2].recommendation).toContain("Refactor to 'transform'");

        expect(audits[3].isLayoutTriggering).toBe(true);
      });

      it("calculates jank rate metrics correctly", () => {
        const auditor = new HeadlessMotionPreFlightAuditor();
        const smoothFrames = Array.from({ length: 60 }, (_, i) => ({
          timestampMs: i * 16.6,
          durationMs: 16.6,
        }));

        const smoothRes = auditor.calculateJankRate(smoothFrames);
        expect(smoothRes.totalFrames).toBe(60);
        expect(smoothRes.jankFrames).toBe(0);
        expect(smoothRes.jankRate).toBe(0);

        const jankyFrames = [
          ...smoothFrames.slice(0, 50),
          ...Array.from({ length: 10 }, (_, i) => ({
            timestampMs: 50 * 16.6 + i * 25,
            durationMs: 25.0, // Jank!
          })),
        ];

        const jankyRes = auditor.calculateJankRate(jankyFrames);
        expect(jankyRes.jankFrames).toBe(10);
        expect(jankyRes.jankRate).toBeCloseTo(10 / 60, 2);
      });

      it("audits pre-flight animation cleanly when meeting 60fps and GPU acceleration", () => {
        const auditor = new HeadlessMotionPreFlightAuditor();
        const input: MotionHeadlessPreFlightInput = {
          animationName: "sidebar-slide",
          targetSelector: ".sidebar",
          animatedProperties: ["transform", "opacity"],
          frameSamples: Array.from({ length: 30 }, (_, i) => ({
            timestampMs: i * 16.6,
            durationMs: 16.6,
          })),
          layoutShifts: [{ shiftScore: 0.0005 }],
        };

        const result = auditor.auditAnimation(input);
        expect(result.passed).toBe(true);
        expect(result.jankRate).toBe(0);
        expect(result.cumulativeLayoutShift).toBe(0.0005);
        expect(result.violations.length).toBe(0);
      });

      it("rejects animation failing pre-flight with layout triggering properties and high jank", () => {
        const auditor = new HeadlessMotionPreFlightAuditor();
        const input: MotionHeadlessPreFlightInput = {
          animationName: "accordion-expand",
          targetSelector: ".accordion-body",
          animatedProperties: ["height", "margin-top"], // Layout triggers!
          frameSamples: Array.from({ length: 20 }, (_, i) => ({
            timestampMs: i * 25,
            durationMs: 25, // All jank!
          })),
          layoutShifts: [{ shiftScore: 0.05 }], // Excessive CLS!
        };

        const result = auditor.auditAnimation(input);
        expect(result.passed).toBe(false);
        expect(result.layoutTriggeringViolations.length).toBe(2);
        expect(result.violations.some((v) => v.includes("Jank rate"))).toBe(true);
        expect(result.violations.some((v) => v.includes("Cumulative Layout Shift"))).toBe(true);
      });

      it("throws HarnessError on invalid pre-flight inputs", () => {
        const auditor = new HeadlessMotionPreFlightAuditor();
        expect(() => auditor.auditProperties(null as any)).toThrow(HarnessError);
        expect(() => auditor.auditAnimation(null as any)).toThrow(HarnessError);
      });
    });

    describe("Phase 2: Temporal Keyframe Step-Sampling", () => {
      it("samples 0% inception, 50% midpoint, and 100% resting states cleanly", () => {
        const sampler = new TemporalKeyframeStepSampler();
        const samples: KeyframeSamplePoint[] = [
          { point: "0%", timestampMs: 0, value: 0 },
          { point: "50%", timestampMs: 150, value: 0.5 },
          { point: "100%", timestampMs: 300, value: 1.0 },
        ];

        const res = sampler.sampleAndAnalyze({
          animationName: "fade-in",
          durationMs: 300,
          samples,
          easingType: "ease-out",
        });

        expect(res.passed).toBe(true);
        expect(res.sampledInception0).toBe(true);
        expect(res.sampledMidpoint50).toBe(true);
        expect(res.sampledFinal100).toBe(true);
        expect(res.easingCurveValid).toBe(true);
        expect(res.bounceOvershootDetected).toBe(false);
      });

      it("detects missing keyframe checkpoints, overshoot anomalies, and blur artifacts", () => {
        const sampler = new TemporalKeyframeStepSampler();
        const samples: KeyframeSamplePoint[] = [
          { point: "0%", timestampMs: 0, value: 0 },
          { point: "50%", timestampMs: 150, value: 1.4, blurDetected: true }, // Overshoot + blur
          // Missing 100% keyframe
        ];

        const res = sampler.sampleAndAnalyze({
          animationName: "bad-dialog-pop",
          durationMs: 300,
          samples,
          easingType: "linear", // Non-spring easing does not allow overshoot
        });

        expect(res.passed).toBe(false);
        expect(res.sampledFinal100).toBe(false);
        expect(res.bounceOvershootDetected).toBe(true);
        expect(res.blurArtifactDetected).toBe(true);
        expect(res.violations.length).toBeGreaterThanOrEqual(3);
      });

      it("throws HarnessError on invalid keyframe inspection inputs", () => {
        const sampler = new TemporalKeyframeStepSampler();
        expect(() => sampler.sampleAndAnalyze(null as any)).toThrow(HarnessError);
      });
    });
});
