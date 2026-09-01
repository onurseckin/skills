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


describe("Design System Tokens - Sovereign Constants & Raw Value Policy", () => {
describe("1. Design System Token Sovereign Constants", () => {
    it("should provide canonical modular spacing scale tokens", () => {
      expect(SPACING_TOKENS.none).toBe(0);
      expect(SPACING_TOKENS["3xs"]).toBe(2);
      expect(SPACING_TOKENS["2xs"]).toBe(4);
      expect(SPACING_TOKENS.xs).toBe(8);
      expect(SPACING_TOKENS.sm).toBe(12);
      expect(SPACING_TOKENS.md).toBe(16);
      expect(SPACING_TOKENS.lg).toBe(24);
      expect(SPACING_TOKENS.xl).toBe(32);
      expect(SPACING_TOKENS["2xl"]).toBe(48);
      expect(SPACING_TOKENS["3xl"]).toBe(64);
      expect(SPACING_TOKENS["4xl"]).toBe(96);
      expect(SPACING_TOKENS["5xl"]).toBe(128);

      expect(VALID_SPACING_VALUES).toContain(16);
      expect(VALID_SPACING_VALUES).not.toContain(13);
      expect(VALID_SPACING_VALUES).not.toContain(17);
    });

    it("should provide typography tokens with font sizes, weights, and line heights", () => {
      expect(TYPOGRAPHY_TOKENS.fontFamilies.sans).toContain("Inter");
      expect(TYPOGRAPHY_TOKENS.fontFamilies.serif).toContain("Playfair Display");
      expect(TYPOGRAPHY_TOKENS.fontFamilies.mono).toContain("JetBrains Mono");

      expect(TYPOGRAPHY_TOKENS.fontSizes.xs).toBe(12);
      expect(TYPOGRAPHY_TOKENS.fontSizes.base).toBe(16);
      expect(TYPOGRAPHY_TOKENS.fontSizes["5xl"]).toBe(48);

      expect(VALID_FONT_SIZES).toContain(16);
      expect(VALID_FONT_SIZES).not.toContain(15);

      expect(VALID_FONT_WEIGHTS).toEqual([400, 500, 600, 700]);
      expect(VALID_LINE_HEIGHTS).toContain(1.5);
    });

    it("should provide semantic color palettes across light, dark, and high-contrast themes", () => {
      expect(COLOR_PALETTES.light.primary).toBe("#2563eb");
      expect(COLOR_PALETTES.light.background).toBe("#ffffff");
      expect(COLOR_PALETTES.light.surface).toBe("#f8fafc");

      expect(COLOR_PALETTES.dark.primary).toBe("#3b82f6");
      expect(COLOR_PALETTES.dark.background).toBe("#0b0f19");
      expect(COLOR_PALETTES.dark.surface).toBe("#111827");

      expect(COLOR_PALETTES["high-contrast"].background).toBe("#ffffff");
      expect(COLOR_PALETTES["high-contrast"].border).toBe("#000000");
    });

    it("should provide shadow elevations, border radii, and transition tokens", () => {
      expect(SHADOW_ELEVATIONS.none).toBe("none");
      expect(SHADOW_ELEVATIONS.md).toContain("rgba(0, 0, 0, 0.1)");
      expect(SHADOW_ELEVATIONS["2xl"]).toBeDefined();

      expect(BORDER_RADII.none).toBe(0);
      expect(BORDER_RADII.md).toBe(8);
      expect(BORDER_RADII.full).toBe(9999);
      expect(VALID_BORDER_RADII_VALUES).toContain(8);

      expect(TRANSITION_TOKENS.durations.instant).toBe(0);
      expect(TRANSITION_TOKENS.durations.fast).toBe(150);
      expect(VALID_TRANSITION_DURATIONS).toContain(250);
      expect(TRANSITION_TOKENS.easings.spring).toContain("cubic-bezier");
    });
  });

  describe("2. Zero Raw Value Policy & AST / Style Inspector", () => {
    it("should validate compliant style maps without violations", () => {
      const result = validateZeroRawValues({
        margin: "16px",
        padding: "24px",
        "font-size": "16px",
        "border-radius": "8px",
        color: "var(--color-text-primary)",
        "background-color": "#ffffff",
      });

      expect(result.valid).toBe(true);
      expect(result.violationCount).toBe(0);
      expect(result.violations.length).toBe(0);
    });

    it("should flag unauthorized raw pixel spacing and suggest nearest valid token", () => {
      const result = validateZeroRawValues({
        margin: "13px",
        "padding-top": "23px",
      });

      expect(result.valid).toBe(false);
      expect(result.violationCount).toBe(2);

      const marginViolation = result.violations.find((v) => v.property === "margin");
      expect(marginViolation).toBeDefined();
      expect(marginViolation?.violationType).toBe("unauthorized_pixel_value");
      expect(marginViolation?.recommendedToken).toContain("SPACING_TOKENS");
      expect(marginViolation?.recommendedToken).toContain("12px"); // Nearest to 13px is 12px (sm)

      const paddingViolation = result.violations.find((v) => v.property === "padding-top");
      expect(paddingViolation?.recommendedToken).toContain("24px"); // Nearest to 23px is 24px (lg)
    });

    it("should flag unauthorized raw hex colors", () => {
      const result = validateZeroRawValues({
        color: "#fa7268", // Non-token uncalibrated hex
      });

      expect(result.valid).toBe(false);
      expect(result.violationCount).toBe(1);
      expect(result.violations[0]?.violationType).toBe("unauthorized_color");
      expect(result.violations[0]?.recommendedToken).toBe("COLOR_PALETTES[theme][role]");
    });

    it("should parse and validate raw string CSS with line tracking", () => {
      const css = `
        .card {
          margin: 17px;
          font-size: 15px;
          border-radius: 9px;
          background: #33aacc;
        }
      `;

      const result = validateZeroRawValues(css);
      expect(result.valid).toBe(false);
      expect(result.violationCount).toBeGreaterThanOrEqual(3);

      const marginV = result.violations.find((v) => v.property === "margin");
      expect(marginV?.line).toBe(3);
      expect(marginV?.recommendedToken).toContain("16px"); // Nearest to 17px is 16px (md)
    });
  });

  describe("3. Implementer Token-Compliance Immunity Engine", () => {
    it("should validate compliant style adjustment requests", () => {
      const immunity = new TokenComplianceImmunity();
      const check = immunity.validateRequestCompliance({
        reviewerName: "UI Visual Reviewer",
        componentTarget: "PrimaryButton",
        requestedProperty: "padding",
        requestedValue: "16px",
        reviewerCritique: "Button needs more padding",
      });

      expect(check.compliant).toBe(true);
    });

    it("should identify non-compliant style requests and generate structured immunity defense receipts", () => {
      const immunity = new TokenComplianceImmunity();
      const request = {
        reviewerName: "UI Visual Reviewer",
        componentTarget: "NavigationBar",
        requestedProperty: "margin-left",
        requestedValue: "13px",
        reviewerCritique: "Nudge left margin by exactly 13px for custom optical balance",
      };

      const check = immunity.validateRequestCompliance(request);
      expect(check.compliant).toBe(false);
      expect(check.suggestedTokens?.[0]).toContain("12px");

      const defense = immunity.generateImmunityDefense(request);
      expect(defense.defenseId).toContain("DEFENSE-TKN-");
      expect(defense.status).toBe("INVOKED");
      expect(defense.citedTokenStandard).toContain("SPACING_TOKENS");
      expect(defense.compliantAlternative.tokenName).toBe("sm");
      expect(defense.compliantAlternative.tokenValue).toBe(12);
      expect(defense.compliantAlternative.cssExpression).toContain("--spacing-sm");
      expect(defense.defenseReasoning).toContain("Token-Compliance Immunity");
      expect(defense.defenseReasoning).toContain("Master Strategic Blueprint Section 12.2");
      expect(defense.defenseReasoning).toContain("rejected");
    });
  });
});
