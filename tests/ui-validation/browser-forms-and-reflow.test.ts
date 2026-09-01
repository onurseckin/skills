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


describe("Browser Choreography - Forms & Responsive Reflow", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

describe("Dynamic Form Exploration & Stress Testing", () => {
      it("generates canonical stress inputs for text and number fields", () => {
        const explorer = new FormStressExplorer();
        const textField: FormFieldDescriptor = {
          fieldId: "username",
          selector: "input#username",
          type: "text",
        };
        const numField: FormFieldDescriptor = {
          fieldId: "amount",
          selector: "input#amount",
          type: "number",
        };
        const checkField: FormFieldDescriptor = {
          fieldId: "terms",
          selector: "input#terms",
          type: "checkbox",
        };

        const textInputs = explorer.generateStressInputs(textField);
        expect(textInputs.some((i) => i.key === "LONG_STRING_1000")).toBe(true);
        expect(textInputs.some((i) => i.key === "UNICODE_EMOJIS")).toBe(true);
        expect(textInputs.some((i) => i.key === "RTL_SCRIPTS")).toBe(true);
        expect(textInputs.some((i) => i.key === "SPECIAL_CHARS_INJECTION")).toBe(true);
        expect(textInputs.some((i) => i.key === "ZERO_WIDTH_SPACES")).toBe(true);
        expect(textInputs.some((i) => i.key === "EMPTY")).toBe(true);
        expect(textInputs.some((i) => i.key === "WHITESPACE_ONLY")).toBe(true);

        const numInputs = explorer.generateStressInputs(numField);
        expect(numInputs.some((i) => i.key === "EXTREME_NUMBERS_MAX_SAFE")).toBe(true);
        expect(numInputs.some((i) => i.key === "EXTREME_NUMBERS_EXPONENTIAL")).toBe(true);

        const checkInputs = explorer.generateStressInputs(checkField);
        expect(checkInputs.length).toBe(1);
      });

      it("inspects overflow metrics accurately", () => {
        const explorer = new FormStressExplorer();
        const normal = explorer.inspectOverflow(100, 120, 30, 40);
        expect(normal.overflowDetected).toBe(false);
        expect(normal.horizontalOverflow).toBe(false);

        const overflow = explorer.inspectOverflow(350, 200, 30, 30);
        expect(overflow.overflowDetected).toBe(true);
        expect(overflow.horizontalOverflow).toBe(true);
        expect(overflow.textTruncated).toBe(true);
      });

      it("validates banner theme and ARIA accessibility", () => {
        const explorer = new FormStressExplorer();
        const validBanner = {
          present: true,
          message: "Field required",
          theme: "error" as const,
          ariaRole: "alert",
          ariaLive: "assertive" as const,
          ariaDescribedByMatch: true,
          contrastRatioValid: true,
        };
        const validRes = explorer.validateBannerAccessibility(validBanner);
        expect(validRes.valid).toBe(true);
        expect(validRes.violations.length).toBe(0);

        const badBanner = {
          present: true,
          message: "Invalid input",
          ariaRole: "button", // invalid role for banner
          ariaLive: "off" as const, // invalid live region
          ariaDescribedByMatch: false,
          contrastRatioValid: false,
        };
        const badRes = explorer.validateBannerAccessibility(badBanner);
        expect(badRes.valid).toBe(false);
        expect(badRes.violations.length).toBe(4);
      });

      it("evaluates comprehensive field stress results", () => {
        const explorer = new FormStressExplorer();
        const evaluations = [
          {
            fieldId: "user-profile.name",
            inputKey: "LONG_STRING_1000",
            value: CANONICAL_STRESS_INPUTS.LONG_STRING_1000,
            scrollWidth: 500,
            clientWidth: 300, // Overflow!
            scrollHeight: 30,
            clientHeight: 30,
            accepted: true,
          },
          {
            fieldId: "user-profile.email",
            inputKey: "SPECIAL_CHARS_INJECTION",
            value: CANONICAL_STRESS_INPUTS.SPECIAL_CHARS_INJECTION,
            scrollWidth: 200,
            clientWidth: 250,
            scrollHeight: 30,
            clientHeight: 30,
            accepted: false,
            validationBanner: {
              present: true,
              message: "Invalid email format",
              theme: "error" as const,
              ariaRole: "alert",
              ariaLive: "assertive" as const,
              ariaDescribedByMatch: true,
              contrastRatioValid: true,
            },
          },
        ];

        const report = explorer.evaluateFieldStressResults(evaluations);
        expect(report.totalTests).toBe(2);
        expect(report.failedTests).toBe(1);
        expect(report.passedTests).toBe(1);
        expect(report.overflowViolations.length).toBe(1);
        expect(report.overallValid).toBe(false);
      });

      it("throws HarnessError on invalid form stress inputs", () => {
        const explorer = new FormStressExplorer();
        expect(() => explorer.generateStressInputs(null as any)).toThrow(HarnessError);
        expect(() => explorer.evaluateFieldStressResults([])).toThrow(HarnessError);
      });
    });

    describe("Responsive Reflow & Breakpoint Probing", () => {
      it("verifies standard viewports definitions and touch hitbox minimums", () => {
        expect(STANDARD_VIEWPORTS.ULTRA_WIDE_DESKTOP.width).toBe(1920);
        expect(STANDARD_VIEWPORTS.STANDARD_DESKTOP.width).toBe(1440);
        expect(STANDARD_VIEWPORTS.TABLET_PORTRAIT.width).toBe(768);
        expect(STANDARD_VIEWPORTS.MOBILE_PORTRAIT.width).toBe(390);

        expect(TOUCH_HITBOX_MINIMUMS.STANDARD.width).toBe(44);
        expect(TOUCH_HITBOX_MINIMUMS.COCKPIT.width).toBe(48);
      });

      it("validates touch hitboxes for standard and cockpit controls", () => {
        const prober = new ResponsiveReflowProber();
        const hitboxes: TouchHitbox[] = [
          { elementId: "btn-submit", selector: "#btn-submit", width: 44, height: 44 },
          { elementId: "btn-small", selector: ".icon-btn", width: 32, height: 32 },
          { elementId: "cockpit-abort", selector: "#abort-btn", width: 48, height: 48, isCockpitControl: true },
          { elementId: "cockpit-small", selector: "#arm-btn", width: 44, height: 44, isCockpitControl: true },
        ];

        const results = prober.validateTouchHitboxes(hitboxes);
        expect(results[0].compliant).toBe(true);
        expect(results[1].compliant).toBe(false);
        expect(results[2].compliant).toBe(true);
        expect(results[3].compliant).toBe(false); // Cockpit requires >= 48x48
      });

      it("probes individual breakpoint metrics and mobile menu transitions", () => {
        const prober = new ResponsiveReflowProber();
        const passResult = prober.probeBreakpoint(STANDARD_VIEWPORTS.MOBILE_PORTRAIT, {
          scrollWidth: 390,
          clientWidth: 390,
          clippedElements: [],
          hitboxes: [{ elementId: "menu-btn", selector: "#menu", width: 48, height: 48 }],
          mobileMenu: {
            triggerSelector: "#menu-toggle",
            menuSelector: "#mobile-drawer",
            opensOnTap: true,
            animatesSmoothly: true,
            closesOnSelectionOrBackdrop: true,
          },
        });

        expect(passResult.reflowPassed).toBe(true);
        expect(passResult.horizontalScrollDetected).toBe(false);
        expect(passResult.violations.length).toBe(0);

        const failResult = prober.probeBreakpoint(STANDARD_VIEWPORTS.MOBILE_PORTRAIT, {
          scrollWidth: 420, // Horizontal overflow!
          clientWidth: 390,
          clippedElements: [".table-container"],
          mobileMenu: {
            triggerSelector: "#menu-toggle",
            menuSelector: "#mobile-drawer",
            opensOnTap: false,
            animatesSmoothly: false,
            closesOnSelectionOrBackdrop: false,
          },
        });

        expect(failResult.reflowPassed).toBe(false);
        expect(failResult.horizontalScrollDetected).toBe(true);
        expect(failResult.violations.length).toBeGreaterThanOrEqual(3);
      });

      it("probes all 4 standard breakpoints", () => {
        const prober = new ResponsiveReflowProber();
        const map = {
          "ultra-wide-desktop": { scrollWidth: 1920, clientWidth: 1920 },
          "standard-desktop": { scrollWidth: 1440, clientWidth: 1440 },
          "tablet-portrait": { scrollWidth: 768, clientWidth: 768 },
          "mobile-portrait": { scrollWidth: 390, clientWidth: 390 },
        };

        const results = prober.probeAllStandardBreakpoints(map);
        expect(results["ultra-wide-desktop"].reflowPassed).toBe(true);
        expect(results["standard-desktop"].reflowPassed).toBe(true);
        expect(results["tablet-portrait"].reflowPassed).toBe(true);
        expect(results["mobile-portrait"].reflowPassed).toBe(true);
      });

      it("throws HarnessError on invalid responsive prober inputs", () => {
        const prober = new ResponsiveReflowProber();
        expect(() => prober.validateTouchHitboxes(null as any)).toThrow(HarnessError);
        expect(() => prober.probeBreakpoint(null as any, null as any)).toThrow(HarnessError);
        expect(() => prober.probeAllStandardBreakpoints(null as any)).toThrow(HarnessError);
      });
    });

    describe("BrowserChoreographyEngine Singleton", () => {
      it("manages singleton instance getters, setters, and resetters", () => {
        const engine1 = getDefaultBrowserChoreographyEngine();
        const engine2 = getDefaultBrowserChoreographyEngine();
        expect(engine1).toBe(engine2);

        const custom = new BrowserChoreographyEngine();
        setDefaultBrowserChoreographyEngine(custom);
        expect(getDefaultBrowserChoreographyEngine()).toBe(custom);

        resetDefaultBrowserChoreographyEngine();
        const fresh = getDefaultBrowserChoreographyEngine();
        expect(fresh).not.toBe(custom);
      });
    });
  });

  // =========================================================================
  // 2. Motion Verification Protocol Tests
  // =========================================================================
