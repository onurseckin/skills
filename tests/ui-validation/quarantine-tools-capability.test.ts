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


describe("Tool Quarantine Engine - Capability Stripping", () => {
  beforeEach(() => {
    resetDefaultQuarantineEngine();
  });

  afterEach(() => {
    resetDefaultQuarantineEngine();
  });

describe("ToolQuarantineEngine", () => {
    it("identifies optical validator roles correctly", () => {
      expect(isOpticalValidatorRole("ui-optical-validator")).toBe(true);
      expect(isOpticalValidatorRole("ui-validator")).toBe(true);
      expect(isOpticalValidatorRole("optical-validator")).toBe(true);
      expect(isOpticalValidatorRole("UI_OPTICAL_VALIDATOR")).toBe(true);
      expect(isOpticalValidatorRole("cognitive-ui-validator")).toBe(true);

      expect(isOpticalValidatorRole("implementer")).toBe(false);
      expect(isOpticalValidatorRole("coordinator")).toBe(false);
      expect(isOpticalValidatorRole("ui-mechanic-validator")).toBe(false);
      expect(isOpticalValidatorRole("ui-headless-validator")).toBe(false);
    });

    it("verifies optical quarantine invariants are defined", () => {
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("HEADFUL_VISUAL_SCREENSHOT_REVIEW_MANDATE");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("ZERO_SOURCE_EDITS");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("ZERO_SOURCE_READS");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("ZERO_DIRECTORY_LISTINGS");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("SUPERFICIAL_UI_APPROVAL_BAN");
      expect(OPTICAL_QUARANTINE_INVARIANTS).toContain("HUMAN_GRADE_COGNITIVE_CRITIQUE");
    });

    it("physically strips forbidden tools for ui-optical-validator", () => {
      const engine = new ToolQuarantineEngine();
      const allTools = [
        "run_command",
        "replace_file_content",
        "write_to_file",
        "list_dir",
        "grep_search",
        "find_by_name",
        "click",
        "fill",
        "hover",
        "navigate_page",
        "take_screenshot",
        "view_file",
        "msg:send",
        "task:probe",
      ];

      const stripped = engine.stripTools(allTools, "ui-optical-validator");
      expect(stripped).not.toContain("run_command");
      expect(stripped).not.toContain("replace_file_content");
      expect(stripped).not.toContain("write_to_file");
      expect(stripped).not.toContain("list_dir");
      expect(stripped).not.toContain("grep_search");
      expect(stripped).not.toContain("find_by_name");

      expect(stripped).toContain("click");
      expect(stripped).toContain("fill");
      expect(stripped).toContain("hover");
      expect(stripped).toContain("navigate_page");
      expect(stripped).toContain("take_screenshot");
      expect(stripped).toContain("view_file");
      expect(stripped).toContain("msg:send");
      expect(stripped).toContain("task:probe");
    });

    it("physically strips tool descriptor objects", () => {
      const engine = new ToolQuarantineEngine();
      const tools = [
        { name: "run_command", description: "Execute shell command" },
        { name: "write_to_file", description: "Write source code" },
        { name: "click", description: "Click DOM element" },
        { name: "take_screenshot", description: "Take screenshot" },
      ];

      const stripped = engine.stripTools(tools, "ui-optical-validator");
      expect(stripped.map((t) => t.name)).toEqual(["click", "take_screenshot"]);
    });

    it("does not strip tools for non-optical roles (e.g. implementer)", () => {
      const engine = new ToolQuarantineEngine();
      const tools = ["run_command", "write_to_file", "click"];
      const notStripped = engine.stripTools(tools, "implementer");
      expect(notStripped).toEqual(tools);
    });

    it("verifies capability classifications accurately", () => {
      const engine = new ToolQuarantineEngine();

      expect(engine.verifyCapability("click", "ui-optical-validator").allowed).toBe(true);
      expect(engine.verifyCapability("view_file", "ui-optical-validator").allowed).toBe(true);
      expect(engine.verifyCapability("msg:send", "ui-optical-validator").allowed).toBe(true);

      const runCommand = engine.verifyCapability("run_command", "ui-optical-validator");
      expect(runCommand.allowed).toBe(false);
      expect(runCommand.category).toBe("FORBIDDEN_COMMAND_EXECUTION");

      const writeToFile = engine.verifyCapability("write_to_file", "ui-optical-validator");
      expect(writeToFile.allowed).toBe(false);
      expect(writeToFile.category).toBe("FORBIDDEN_SOURCE_EDITING");

      const listDir = engine.verifyCapability("list_dir", "ui-optical-validator");
      expect(listDir.allowed).toBe(false);
      expect(listDir.category).toBe("FORBIDDEN_DIRECTORY_LISTING");

      const grep = engine.verifyCapability("grep_search", "ui-optical-validator");
      expect(grep.allowed).toBe(false);
      expect(grep.category).toBe("FORBIDDEN_PATTERN_SEARCHING");
    });
});
});
