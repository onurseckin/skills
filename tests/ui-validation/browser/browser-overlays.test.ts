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


describe("Browser Choreography - Z-Index & Overlays", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

describe("Z-Index Elevation Hierarchy & Overlays", () => {
      it("verifies canonical Z-Index hierarchy values and ranges", () => {
        expect(Z_INDEX_HIERARCHY.BASE).toBe(0);
        expect(Z_INDEX_HIERARCHY.STICKY).toBe(100);
        expect(Z_INDEX_HIERARCHY.DROPDOWN).toBe(800);
        expect(Z_INDEX_HIERARCHY.DRAWER).toBe(900);
        expect(Z_INDEX_HIERARCHY.BACKDROP).toBe(950);
        expect(Z_INDEX_HIERARCHY.MODAL).toBe(1000);
        expect(Z_INDEX_HIERARCHY.TOOLTIP).toBe(1100);
        expect(Z_INDEX_HIERARCHY.TOAST).toBe(1200);

        expect(Z_INDEX_LAYER_RANGES.BASE.min).toBe(0);
        expect(Z_INDEX_LAYER_RANGES.MODAL.min).toBe(1000);
        expect(Z_INDEX_LAYER_RANGES.MODAL.max).toBe(1099);
      });

      it("validates compliant overlay z-indices without violations", () => {
        const orchestrator = new OverlayOrchestrator();
        const overlays: OverlayDescriptor[] = [
          {
            id: "nav-dropdown",
            type: "menu",
            selector: ".dropdown-menu",
            zIndex: 850,
            hasBackdrop: false,
            dismissOnEscape: true,
            dismissOnBackdropClick: false,
          },
          {
            id: "confirm-modal",
            type: "modal",
            selector: "#modal-confirm",
            zIndex: 1000,
            hasBackdrop: true,
            backdropZIndex: 950,
            dismissOnEscape: true,
            dismissOnBackdropClick: true,
          },
          {
            id: "toast-alert",
            type: "toast",
            selector: ".toast-banner",
            zIndex: 1250,
            hasBackdrop: false,
            dismissOnEscape: true,
            dismissOnBackdropClick: false,
          },
        ];

        const violations = orchestrator.validateZIndexHierarchy(overlays);
        expect(violations.length).toBe(0);
      });

      it("detects z-index hierarchy violations when overlay or backdrop are out of range", () => {
        const orchestrator = new OverlayOrchestrator();
        const badOverlays: OverlayDescriptor[] = [
          {
            id: "rogue-modal",
            type: "modal",
            selector: "#modal-bad",
            zIndex: 50, // Should be 1000-1099
            hasBackdrop: true,
            backdropZIndex: 1050, // Backdrop above modal!
            dismissOnEscape: true,
            dismissOnBackdropClick: true,
          },
        ];

        const violations = orchestrator.validateZIndexHierarchy(badOverlays);
        expect(violations.length).toBeGreaterThanOrEqual(2);
        expect(violations.some((v) => v.elementId === "rogue-modal")).toBe(true);
        expect(violations.some((v) => v.elementId === "rogue-modal-backdrop")).toBe(true);
      });

      it("checks backdrop occlusion against background elements", () => {
        const orchestrator = new OverlayOrchestrator();
        const modal: OverlayDescriptor = {
          id: "modal-1",
          type: "modal",
          selector: "#m1",
          zIndex: 1000,
          hasBackdrop: true,
          backdropZIndex: 950,
          dismissOnEscape: true,
          dismissOnBackdropClick: true,
        };

        const bgElements = [
          { id: "header", zIndex: 100, bounds: { x: 0, y: 0, width: 1000, height: 60 } },
          { id: "rogue-button", zIndex: 980, bounds: { x: 10, y: 10, width: 100, height: 40 } },
        ];

        const occlusion = orchestrator.checkBackdropOcclusion(modal, bgElements);
        expect(occlusion.occludedCorrectly).toBe(false);
        expect(occlusion.occludingElements).toContain("rogue-button");
        expect(occlusion.violations.length).toBe(1);
      });

      it("verifies overlay dismissal ergonomics", () => {
        const orchestrator = new OverlayOrchestrator();
        const modal: OverlayDescriptor = {
          id: "settings-modal",
          type: "modal",
          selector: "#settings-modal",
          zIndex: 1000,
          hasBackdrop: true,
          dismissOnEscape: true,
          dismissOnBackdropClick: true,
          focusTrapActive: true,
        };

        const successErgonomics = orchestrator.verifyOverlayErgonomics(modal, {
          escapeDismisses: true,
          backdropClickDismisses: true,
          focusTrapped: true,
        });
        expect(successErgonomics.passed).toBe(true);
        expect(successErgonomics.violations.length).toBe(0);

        const failedErgonomics = orchestrator.verifyOverlayErgonomics(modal, {
          escapeDismisses: false,
          backdropClickDismisses: false,
          focusTrapped: false,
        });
        expect(failedErgonomics.passed).toBe(false);
        expect(failedErgonomics.violations.length).toBe(3);
      });

      it("throws HarnessError on invalid overlay arguments", () => {
        const orchestrator = new OverlayOrchestrator();
        expect(() => orchestrator.validateZIndexHierarchy(null as any)).toThrow(HarnessError);
        expect(() => orchestrator.checkBackdropOcclusion(null as any, [])).toThrow(HarnessError);
        expect(() => orchestrator.verifyOverlayErgonomics(null as any)).toThrow(HarnessError);
      });
    });
});
