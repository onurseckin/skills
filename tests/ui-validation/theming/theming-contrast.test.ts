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

describe("Theming - Contrast Calculation & Thematic Gating", () => {
  beforeEach(() => {
    resetDefaultPermutationStagingEngine();
  });

  afterEach(() => {
    resetDefaultPermutationStagingEngine();
  });

  describe("8. Automated Mathematical Contrast Calculation (WCAG 2.1 & APCA)", () => {
    it("should parse various color formats to RGB correctly", () => {
      expect(parseColorToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseColorToRgb("#000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseColorToRgb("rgb(100, 150, 200)")).toEqual({ r: 100, g: 150, b: 200, a: 1 });
      expect(parseColorToRgb("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    });

    it("should calculate accurate WCAG 2.1 relative luminance", () => {
      const blackLum = calculateRelativeLuminance("#000000");
      const whiteLum = calculateRelativeLuminance("#ffffff");

      expect(blackLum).toBe(0);
      expect(whiteLum).toBe(1);

      const midLum = calculateRelativeLuminance("#777777");
      expect(midLum).toBeGreaterThan(0.1);
      expect(midLum).toBeLessThan(0.3);
    });

    it("should calculate WCAG 2.1 contrast ratios and check compliance", () => {
      const maxRatio = calculateWcagContrastRatio("#ffffff", "#000000");
      expect(maxRatio).toBe(21.0);

      const sameRatio = calculateWcagContrastRatio("#ffffff", "#ffffff");
      expect(sameRatio).toBe(1.0);

      const darkBlueOnWhite = calculateWcagContrastRatio("#0f172a", "#ffffff");
      expect(darkBlueOnWhite).toBeGreaterThan(14.0);
      expect(isWcagAaCompliant(darkBlueOnWhite)).toBe(true);
      expect(isWcagAaaCompliant(darkBlueOnWhite)).toBe(true);

      const lowContrast = calculateWcagContrastRatio("#94a3b8", "#ffffff");
      expect(lowContrast).toBeLessThan(4.5);
      expect(isWcagAaCompliant(lowContrast)).toBe(false);
    });

    it("should calculate APCA lightness contrast (Lc) accurately", () => {
      const blackOnWhiteLc = calculateApcaContrast("#000000", "#ffffff");
      expect(blackOnWhiteLc).toBeGreaterThan(95); // High contrast dark-on-light
      expect(isApcaCompliant(blackOnWhiteLc, "body")).toBe(true);
      expect(isApcaCompliant(blackOnWhiteLc, "fluent")).toBe(true);

      const whiteOnDarkLc = calculateApcaContrast("#ffffff", "#0b0f19");
      expect(Math.abs(whiteOnDarkLc)).toBeGreaterThan(95); // High contrast light-on-dark
      expect(isApcaCompliant(whiteOnDarkLc, "body")).toBe(true);

      const lowContrastLc = calculateApcaContrast("#94a3b8", "#ffffff");
      expect(Math.abs(lowContrastLc)).toBeLessThan(60);
      expect(isApcaCompliant(lowContrastLc, "body")).toBe(false);
    });

    it("should sweep surface elements in early rounds using MathematicalContrastPreFilter", () => {
      const preFilter = new MathematicalContrastPreFilter();
      const report = preFilter.sweepSurface("light_standard-desktop", [
        {
          elementId: "heading-1",
          role: "headingText",
          foregroundColor: "#0f172a",
          backgroundColor: "#ffffff",
          isLargeText: true,
        },
        {
          elementId: "body-1",
          role: "bodyText",
          foregroundColor: "#475569",
          backgroundColor: "#ffffff",
        },
        {
          elementId: "failing-muted",
          role: "mutedText",
          foregroundColor: "#cbd5e1", // Low contrast against white
          backgroundColor: "#ffffff",
        },
      ]);

      expect(report.permutationId).toBe("light_standard-desktop");
      expect(report.auditedElementsCount).toBe(3);
      expect(report.passedCount).toBe(2);
      expect(report.failedCount).toBe(1);
      expect(report.allPassed).toBe(false);
    });
  });

  describe("9. Dedicated Round 4 Thematic Gating", () => {
    it("should approve Round 4 gate when all 12 permutations pass thematic integrity", () => {
      const gate = new ThematicGateVerifier();
      const allPermutations = THEME_PERMUTATION_GRID.map((p) => ({
        permutationId: p.permutationId,
        surfaceSeparationPassed: true,
        borderSubtletyPassed: true,
        iconClarityPassed: true,
        readabilityPassed: true,
        findings: ["Clean chromatic balance", "Clear border definition"],
      }));

      const report = gate.evaluateRound4Gate(allPermutations);
      expect(report.gateRound).toBe(4);
      expect(report.gateStatus).toBe("APPROVED");
      expect(report.passedPermutationsCount).toBe(12);
      expect(report.failedPermutationsCount).toBe(0);
      expect(report.blockingIssues.length).toBe(0);
    });

    it("should block Round 4 gate when any permutation fails or coverage is incomplete", () => {
      const gate = new ThematicGateVerifier();
      // Only 11 permutations provided, and 1 has surface separation failure
      const partialPermutations = THEME_PERMUTATION_GRID.slice(0, 11).map((p, idx) => ({
        permutationId: p.permutationId,
        surfaceSeparationPassed: idx !== 0, // permutation 0 fails
        borderSubtletyPassed: true,
        iconClarityPassed: true,
        readabilityPassed: true,
        findings: [],
      }));

      const report = gate.evaluateRound4Gate(partialPermutations);
      expect(report.gateStatus).toBe("BLOCKED");
      expect(report.blockingIssues.length).toBeGreaterThan(0);
      expect(report.blockingIssues.some((issue) => issue.includes("coverage"))).toBe(true);
      expect(report.blockingIssues.some((issue) => issue.includes("Surface separation"))).toBe(
        true,
      );
    });
  });

  describe("10. Chromatic Balancing & Real-Time Token Harmony", () => {
    it("should detect high Flash of Unstyled Theme (FOUT) risk", () => {
      const report = detectThemeFlash({
        initialHtmlBg: "#ffffff", // Light white initial
        loadedThemeBg: "#0b0f19", // Dark mode final
        hasInlineThemeScript: false,
        transitionDurationMs: 400,
      });

      expect(report.flashRiskDetected).toBe(true);
      expect(report.riskLevel).toBe("high");
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations[0]).toContain("FOUT");
    });

    it("should calibrate dark mode depth and verify monotonic elevation luminance", () => {
      const validDepth = calibrateDarkDepth({
        backgroundHex: "#0b0f19", // lum ~0.006
        surfaceHex: "#111827", // lum ~0.013
        elevatedHex: "#1f2937", // lum ~0.027
        overlayHex: "#374151", // lum ~0.052
      });

      expect(validDepth.monotonicProgression).toBe(true);
      expect(validDepth.issues.length).toBe(0);

      // Inverted progression where surface is darker than background
      const invalidDepth = calibrateDarkDepth({
        backgroundHex: "#1f2937",
        surfaceHex: "#0b0f19", // Inverted
        elevatedHex: "#111827",
      });

      expect(invalidDepth.monotonicProgression).toBe(false);
      expect(invalidDepth.issues.length).toBeGreaterThan(0);
    });

    it("should validate high-contrast boundaries for sharpness and minimum 7:1 contrast", () => {
      const sharpBoundary = validateHighContrastBoundaries({
        borderStyle: "solid",
        borderWidthPx: 2,
        borderColor: "#000000",
        backgroundColor: "#ffffff",
      });

      expect(sharpBoundary.boundarySharp).toBe(true);
      expect(sharpBoundary.contrastRatio).toBe(21.0);
      expect(sharpBoundary.issues.length).toBe(0);

      const weakBoundary = validateHighContrastBoundaries({
        borderStyle: "solid",
        borderWidthPx: 1,
        borderColor: "#94a3b8", // Low contrast against white
        backgroundColor: "#ffffff",
      });

      expect(weakBoundary.boundarySharp).toBe(false);
      expect(weakBoundary.issues[0]).toContain("7.0:1 AAA");
    });
  });

  describe("11. Permutation Staging Engine & Singletons", () => {
    it("should manage default singleton instance", () => {
      const defaultEngine = getDefaultPermutationStagingEngine();
      expect(defaultEngine).toBeInstanceOf(PermutationStagingEngine);
      expect(defaultEngine.gridManager).toBeInstanceOf(PermutationGridManager);
      expect(defaultEngine.preFilter).toBeInstanceOf(MathematicalContrastPreFilter);

      const customEngine = new PermutationStagingEngine();
      setDefaultPermutationStagingEngine(customEngine);
      expect(getDefaultPermutationStagingEngine()).toBe(customEngine);

      resetDefaultPermutationStagingEngine();
      expect(getDefaultPermutationStagingEngine()).not.toBe(customEngine);
    });
  });
});
