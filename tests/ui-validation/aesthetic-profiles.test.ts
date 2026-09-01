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


describe("Aesthetic Profiles & Optical Dimensions", () => {
  beforeEach(() => {
    resetDefaultAestheticProfileEvaluator();
  });

  afterEach(() => {
    resetDefaultAestheticProfileEvaluator();
  });

describe("12. Eight Optical Dimensions & Industry Aesthetic Profiles", () => {
    it("should define all eight optical dimensions with metadata", () => {
      expect(OPTICAL_DIMENSIONS.length).toBe(8);
      for (const dim of OPTICAL_DIMENSIONS) {
        expect(OPTICAL_DIMENSION_METADATA[dim]).toBeDefined();
        expect(OPTICAL_DIMENSION_METADATA[dim].name).toBeDefined();
        expect(OPTICAL_DIMENSION_METADATA[dim].description).toBeDefined();
      }
    });

    it("should provide calibrated standard profiles for Enterprise, Luxury, and Telematics", () => {
      expect(ENTERPRISE_ACCOUNTING_PROFILE.profileId).toBe("enterprise_accounting");
      expect(ENTERPRISE_ACCOUNTING_PROFILE.enforceMonospaceForNumbers).toBe(true);

      expect(LUXURY_HOSPITALITY_PROFILE.profileId).toBe("luxury_hospitality");
      expect(LUXURY_HOSPITALITY_PROFILE.requireGenerousWhitespace).toBe(true);

      expect(FLEET_TELEMATICS_PROFILE.profileId).toBe("fleet_telematics");
      expect(FLEET_TELEMATICS_PROFILE.minTouchTargetPx).toBe(48);
      expect(FLEET_TELEMATICS_PROFILE.requireStatusColorEncoding).toBe(true);

      expect(STANDARD_AESTHETIC_PROFILES.enterprise_accounting).toBe(ENTERPRISE_ACCOUNTING_PROFILE);
    });

    it("should evaluate UI descriptor, detect descender clipping risks, and generate Socratic challenges", () => {
      const evaluator = new AestheticProfileEvaluator();

      const uiWithDescenderClipping: UiDescriptor = {
        viewName: "UserProfileView",
        theme: "light",
        elements: [
          {
            elementId: "badge-tag",
            tagName: "span",
            textContent: "Typography & Logging", // Contains 'p', 'g', 'y' descenders
            boundingBox: { width: 120, height: 16, top: 10, left: 10 },
            computedStyles: {
              lineHeight: 1.0, // Dangerous line height < 1.25
              overflow: "hidden", // Overflow hidden with tight line height truncates descenders!
              color: "#0f172a",
              backgroundColor: "#f8fafc",
            },
          },
          {
            elementId: "submit-btn",
            tagName: "button",
            isInteractive: true,
            boundingBox: { width: 32, height: 32, top: 50, left: 10 }, // 32px is below 44px min
            computedStyles: {
              color: "#ffffff",
              backgroundColor: "#2563eb",
              padding: "16px",
            },
          },
        ],
      };

      const report = evaluator.evaluateUiDescriptor(
        uiWithDescenderClipping,
        "enterprise_accounting",
      );

      expect(report.passed).toBe(false);
      expect(report.violations.length).toBeGreaterThanOrEqual(2);

      const descenderViolation = report.violations.find((v) => v.dimension === "clipping-overflow");
      expect(descenderViolation).toBeDefined();
      expect(descenderViolation?.severity).toBe("critical");
      expect(descenderViolation?.message).toContain("descenders");

      const hitboxViolation = report.violations.find((v) => v.dimension === "touch-ergonomics");
      expect(hitboxViolation).toBeDefined();
      expect(hitboxViolation?.message).toContain("44x44px");

      // Verify Socratic challenges generated
      expect(report.socraticChallenges.length).toBeGreaterThan(0);
      expect(report.socraticChallenges[0]?.inquiry).toContain("How might we elevate");
    });

    it("should enforce monospace / tabular numbers in Enterprise Tax & Accounting profile", () => {
      const evaluator = new AestheticProfileEvaluator();

      const ui: UiDescriptor = {
        viewName: "TaxLedgerView",
        theme: "light",
        elements: [
          {
            elementId: "revenue-figure",
            tagName: "td",
            textContent: "$1,234,567.89",
            isNumericReportData: true,
            boundingBox: { width: 120, height: 24, top: 10, left: 10 },
            computedStyles: {
              fontFamily: "Comic Sans MS, cursive", // Non-monospace font for financial figures
              color: "#0f172a",
              backgroundColor: "#ffffff",
            },
          },
        ],
      };

      const report = evaluator.evaluateUiDescriptor(ui, "enterprise_accounting");
      const typoViolation = report.violations.find((v) => v.dimension === "typography-rendering");
      expect(typoViolation).toBeDefined();
      expect(typoViolation?.message).toContain("monospace or tabular-nums");
    });

    it("should enforce 48px touch targets and status color encoding in Fleet Telematics profile", () => {
      const evaluator = new AestheticProfileEvaluator();

      const ui: UiDescriptor = {
        viewName: "CockpitWidget",
        theme: "dark",
        elements: [
          {
            elementId: "emergency-override-btn",
            tagName: "button",
            isInteractive: true,
            boundingBox: { width: 44, height: 44, top: 10, left: 10 }, // 44px is OK for standard but fails 48px cockpit
            computedStyles: {
              color: "#ffffff",
              backgroundColor: "#dc2626",
            },
          },
        ],
      };

      const report = evaluator.evaluateUiDescriptor(ui, "fleet_telematics");
      const touchViolation = report.violations.find((v) => v.dimension === "touch-ergonomics");
      expect(touchViolation).toBeDefined();
      expect(touchViolation?.message).toContain("48x48px");
    });

    it("should pass flawlessly for well-crafted compliant UI descriptor", () => {
      const evaluator = new AestheticProfileEvaluator();

      const compliantUi: UiDescriptor = {
        viewName: "CompliantAccountingSummary",
        theme: "light",
        elements: [
          {
            elementId: "total-balance",
            tagName: "td",
            textContent: "$54,321.00",
            isNumericReportData: true,
            boundingBox: { width: 150, height: 28, top: 10, left: 10 },
            computedStyles: {
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilies.mono,
              fontSize: "16px",
              lineHeight: 1.5,
              color: "#0f172a",
              backgroundColor: "#ffffff",
              padding: "12px",
            },
          },
          {
            elementId: "export-btn",
            tagName: "button",
            isInteractive: true,
            boundingBox: { width: 120, height: 48, top: 50, left: 10 },
            computedStyles: {
              fontSize: "14px",
              lineHeight: 1.5,
              color: "#ffffff",
              backgroundColor: "#2563eb",
              padding: "16px",
            },
          },
        ],
      };

      const report = evaluator.evaluateUiDescriptor(compliantUi, "enterprise_accounting");
      expect(report.passed).toBe(true);
      expect(report.overallScore).toBeGreaterThanOrEqual(85);
      expect(report.violations.length).toBe(0);
      expect(report.socraticChallenges.length).toBe(0);
    });

    it("should manage default singleton instance for AestheticProfileEvaluator", () => {
      const defaultEval = getDefaultAestheticProfileEvaluator();
      expect(defaultEval).toBeInstanceOf(AestheticProfileEvaluator);

      const customEval = new AestheticProfileEvaluator();
      setDefaultAestheticProfileEvaluator(customEval);
      expect(getDefaultAestheticProfileEvaluator()).toBe(customEval);

      resetDefaultAestheticProfileEvaluator();
      expect(getDefaultAestheticProfileEvaluator()).not.toBe(customEval);
    });
  });
});
