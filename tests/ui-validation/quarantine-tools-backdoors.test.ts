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


describe("Tool Quarantine Engine - Backdoor Detection & Invariants", () => {
  beforeEach(() => {
    resetDefaultQuarantineEngine();
  });

  afterEach(() => {
    resetDefaultQuarantineEngine();
  });

  describe("Backdoor Detection & Compliance", () => {
it("detects backdoor script injection in evaluate_script", () => {
      const engine = new ToolQuarantineEngine();

      // Malicious fs read attempt
      const fsBypass = engine.detectBackdoorBypass("evaluate_script", {
        script: "const fs = require('fs'); fs.readFileSync('/etc/passwd');",
      });
      expect(fsBypass.detected).toBe(true);
      expect(fsBypass.severity).toBe("CRITICAL");

      // Malicious child process attempt
      const procBypass = engine.detectBackdoorBypass("mcp_chrome-devtools_evaluate_script", {
        script: "process.env.SECRET_TOKEN",
      });
      expect(procBypass.detected).toBe(true);

      // Safe script
      const safeScript = engine.detectBackdoorBypass("evaluate_script", {
        script: "document.querySelector('button.primary').getBoundingClientRect();",
      });
      expect(safeScript.detected).toBe(false);
    });

    it("detects file:// and javascript: backdoor bypasses in navigation URLs", () => {
      const engine = new ToolQuarantineEngine();

      const fileUrl = engine.detectBackdoorBypass("navigate_page", {
        url: "file:///Users/secret/repo/config.env",
      });
      expect(fileUrl.detected).toBe(true);
      expect(fileUrl.vector).toBe("LOCAL_FILESYSTEM_OR_DATA_URL_BYPASS");

      const jsUrl = engine.detectBackdoorBypass("navigate_page", {
        url: "javascript:document.write(localStorage.getItem('token'))",
      });
      expect(jsUrl.detected).toBe(true);

      const safeUrl = engine.detectBackdoorBypass("navigate_page", {
        url: "http://localhost:3000/dashboard",
      });
      expect(safeUrl.detected).toBe(false);
    });

    it("enforces view_file to only permit image screenshots and block source code inspection", () => {
      const engine = new ToolQuarantineEngine();

      // Blocked source code files
      const tsView = engine.detectBackdoorBypass("view_file", {
        AbsolutePath: "/Users/dev/repo/src/components/Button.tsx",
      });
      expect(tsView.detected).toBe(true);
      expect(tsView.vector).toBe("SOURCE_CODE_READ_ATTEMPT_VIA_VIEW_FILE");

      const jsonView = engine.detectBackdoorBypass("view_file", {
        path: "/Users/dev/repo/package.json",
      });
      expect(jsonView.detected).toBe(true);

      const pyView = engine.detectBackdoorBypass("view_file", {
        filePath: "/Users/dev/repo/server.py",
      });
      expect(pyView.detected).toBe(true);

      // Permitted image screenshots
      const pngView = engine.detectBackdoorBypass("view_file", {
        AbsolutePath: "/Users/dev/repo/.olt/capsules/run-01/evidence/screenshots/dashboard-1440x900.png",
      });
      expect(pngView.detected).toBe(false);

      const webpView = engine.detectBackdoorBypass("view_file", {
        AbsolutePath: "/Users/dev/repo/.olt/capsules/run-01/evidence/screenshots/modal-390x844.webp",
      });
      expect(webpView.detected).toBe(false);
    });

    it("detects shell command injection patterns in string arguments", () => {
      const engine = new ToolQuarantineEngine();

      const injected = engine.detectBackdoorBypass("click", {
        selector: "#submit-btn; rm -rf /",
      });
      expect(injected.detected).toBe(true);
      expect(injected.vector).toBe("SHELL_INJECTION_IN_ARGUMENT");

      const safeClick = engine.detectBackdoorBypass("click", {
        selector: "button[data-testid='submit-login']",
      });
      expect(safeClick.detected).toBe(false);
    });

    it("enforces runtime boundary and logs audit records", () => {
      const engine = new ToolQuarantineEngine();

      // Allowed invocation
      const allowedAudit = engine.auditToolInvocation({
        agentId: "opt-val-01",
        role: "ui-optical-validator",
        toolName: "take_screenshot",
        args: { format: "png" },
      });
      expect(allowedAudit.decision).toBe("ALLOWED");
      expect(allowedAudit.bypassDetected).toBe(false);

      // Blocked forbidden tool
      const blockedAudit = engine.auditToolInvocation({
        agentId: "opt-val-01",
        role: "ui-optical-validator",
        toolName: "run_command",
        args: { CommandLine: "ls" },
      });
      expect(blockedAudit.decision).toBe("BLOCKED");

      // Blocked backdoor bypass
      const bypassAudit = engine.auditToolInvocation({
        agentId: "opt-val-01",
        role: "ui-optical-validator",
        toolName: "view_file",
        args: { AbsolutePath: "/repo/src/index.ts" },
      });
      expect(bypassAudit.decision).toBe("BLOCKED");
      expect(bypassAudit.bypassDetected).toBe(true);

      const history = engine.getAuditHistory();
      expect(history.length).toBe(3);

      engine.clearAuditHistory();
      expect(engine.getAuditHistory().length).toBe(0);
    });

    it("assertOpticalQuarantineCompliance throws HarnessError for violations", () => {
      const engine = new ToolQuarantineEngine();

      // Throws on forbidden tool
      expect(() => {
        engine.assertOpticalQuarantineCompliance("write_to_file", { TargetFile: "/foo.ts" });
      }).toThrow(HarnessError);

      // Throws on backdoor bypass
      expect(() => {
        engine.assertOpticalQuarantineCompliance("navigate_page", { url: "file:///etc/hosts" });
      }).toThrow(HarnessError);

      // Passes on authorized tool
      expect(() => {
        engine.assertOpticalQuarantineCompliance("take_screenshot", {});
      }).not.toThrow();
    });

    it("manages singleton instance correctly", () => {
      const defaultEngine = getDefaultQuarantineEngine();
      expect(defaultEngine).toBeInstanceOf(ToolQuarantineEngine);
      expect(getDefaultQuarantineEngine()).toBe(defaultEngine);

      const customEngine = new ToolQuarantineEngine();
      setDefaultQuarantineEngine(customEngine);
      expect(getDefaultQuarantineEngine()).toBe(customEngine);
    });
  });

  // =========================================================================
  // 2. Parameter Extractor Tests
  // =========================================================================
  });
