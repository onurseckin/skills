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


describe("Socratic Dialectic - Defense Evaluation & Session Progression", () => {
  beforeEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

describe("2. Substantive Defense Evaluation & Cognitive Challenge Quotas", () => {
    it("should reject defenses with trivial boilerplate phrases", () => {
      const trivialPhrases = [
        "lgtm",
        "looks good",
        "looks good to me",
        "fixed",
        "fixed it",
        "done",
        "ok",
        "fine",
        "resolved",
        "no issue",
        "no change needed",
        "as expected",
        "working fine",
        "it works",
      ];

      for (const phrase of trivialPhrases) {
        const submission: DefenseSubmission = {
          challengeId: "test-chall",
          rationale: phrase,
          evidenceReferences: ["token-123"],
        };
        const result = evaluateSubstantiveDefense(submission);
        expect(result.isAccepted).toBe(false);
        expect(result.score).toBeLessThan(70);
        expect(result.feedback).toContain("Defense rejected");
      }
    });

    it("should reject defenses that are too short (< MIN_SUBSTANTIVE_DEFENSE_LENGTH)", () => {
      const submission: DefenseSubmission = {
        challengeId: "test-chall",
        rationale: "Small fix applied",
        evidenceReferences: ["token-123"],
      };
      const result = evaluateSubstantiveDefense(submission);
      expect(result.isAccepted).toBe(false);
      expect(result.reasons.some((r) => r.includes("too brief"))).toBe(true);
    });

    it("should reject defenses without evidence references and without architectural tradeoffs", () => {
      const submission: DefenseSubmission = {
        challengeId: "test-chall",
        rationale:
          "The container width has been aligned to the golden ratio grid structure to ensure proper visual breathing room.",
      };
      const result = evaluateSubstantiveDefense(submission);
      expect(result.isAccepted).toBe(false);
      expect(result.reasons.some((r) => r.includes("evidence reference"))).toBe(true);
    });

    it("should accept substantive defenses with evidence references", () => {
      const submission: DefenseSubmission = {
        challengeId: "test-chall",
        rationale:
          "The container width adheres to the canonical 12-column responsive grid with 24px gutters at desktop breakpoints.",
        evidenceReferences: ["token:spacing.lg", "artifact:grid-measurement-diff-01"],
      };
      const result = evaluateSubstantiveDefense(submission);
      expect(result.isAccepted).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.reasons).toHaveLength(0);
    });

    it("should accept substantive defenses with architectural tradeoff justification", () => {
      const submission: DefenseSubmission = {
        challengeId: "test-chall",
        rationale:
          "The card elevation tier was adjusted from 2dp to 4dp to ensure clear separation from the background canvas.",
        architecturalTradeoff:
          "Accepted minor shadow spread increase in exchange for superior tactile hierarchy in low-contrast ambient environments.",
      };
      const result = evaluateSubstantiveDefense(submission);
      expect(result.isAccepted).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(85);
    });
  });

  // ==========================================================================
  // 3. Socratic Dialectic Session Progression & Gate Verification
  // ==========================================================================
  describe("3. Socratic Dialectic Session Progression & Gate Verification", () => {
    it("should enforce mandatory quota of 2 defended challenges before unlocking Round 1 gate", () => {
      const engine = new SocraticDialecticEngine({ sessionId: "test-session-001" });
      expect(engine.getCurrentRoundNumber()).toBe(1);

      // Gate evaluation with 0 challenges
      const readiness0 = engine.evaluateRoundReadiness();
      expect(readiness0.isGateUnlocked).toBe(false);
      expect(readiness0.quotaMet).toBe(false);

      // Attempting to advance throws INVALID_STATE
      expect(() => engine.advanceRound()).toThrow(HarnessError);

      // Raise 1 challenge and defend it
      const chall1 = engine.raiseChallenge({
        category: "spatial-hierarchy",
        thesis: "Is the macro-layout grid properly responsive across mobile and desktop breakpoints?",
      });
      engine.submitDefense({
        challengeId: chall1.challengeId,
        rationale:
          "The macro-layout employs fluid CSS grid with media query breakpoints at 640px, 1024px, and 1440px.",
        evidenceReferences: ["token:spacing.grid.columns", "artifact:responsive-prober-diff"],
      });

      // Still only 1 defended challenge (quota is 2)
      const readiness1 = engine.evaluateRoundReadiness();
      expect(readiness1.isGateUnlocked).toBe(false);
      expect(readiness1.quotaMet).toBe(false);
      expect(() => engine.advanceRound()).toThrow(HarnessError);

      // Raise second challenge
      const chall2 = engine.raiseChallenge({
        category: "structural-landmarks",
        thesis: "Are semantic HTML landmarks (<main>, <nav>, <aside>) properly anchored in the DOM tree?",
      });

      // Challenge 2 is pending, gate still blocked
      const readiness2 = engine.evaluateRoundReadiness();
      expect(readiness2.isGateUnlocked).toBe(false);
      expect(readiness2.pendingChallengesCount).toBe(1);

      // Defend second challenge
      engine.submitDefense({
        challengeId: chall2.challengeId,
        rationale:
          "All top-level layout regions map directly to ARIA landmarks with unique accessible role descriptions.",
        evidenceReferences: ["dom:landmark-audit-log"],
      });

      // Now gate is unlocked
      const readiness3 = engine.evaluateRoundReadiness();
      expect(readiness3.isGateUnlocked).toBe(true);
      expect(readiness3.quotaMet).toBe(true);
      expect(readiness3.allChallengesResolved).toBe(true);

      // Advance to Round 2
      const advanceResult = engine.advanceRound();
      expect(advanceResult.previousRound).toBe(1);
      expect(advanceResult.currentRound).toBe(2);
      expect(engine.getCurrentRoundNumber()).toBe(2);
      expect(advanceResult.manifest.roundNumber).toBe(1);
      expect(advanceResult.manifest.lockStatus).toBe("SEALED");
    });

    it("should throw when raising challenge with empty thesis or category", () => {
      const engine = new SocraticDialecticEngine();
      expect(() =>
        engine.raiseChallenge({ category: "", thesis: "Valid thesis statement goes here" }),
      ).toThrow(HarnessError);
      expect(() =>
        engine.raiseChallenge({ category: "valid-cat", thesis: "" }),
      ).toThrow(HarnessError);
    });

    it("should throw when submitting defense for non-existent challenge or already defended challenge", () => {
      const engine = new SocraticDialecticEngine();
      expect(() =>
        engine.submitDefense({
          challengeId: "non-existent-id",
          rationale: "Valid rationale that is long enough to satisfy substantive criteria.",
          evidenceReferences: ["ref-1"],
        }),
      ).toThrow(HarnessError);

      const chall = engine.raiseChallenge({ category: "cat", thesis: "Thesis statement" });
      engine.submitDefense({
        challengeId: chall.challengeId,
        rationale: "Valid rationale that is long enough to satisfy substantive criteria.",
        evidenceReferences: ["ref-1"],
      });

      // Submitting again to already defended challenge throws
      expect(() =>
        engine.submitDefense({
          challengeId: chall.challengeId,
          rationale: "Another rationale trying to overwrite defended status.",
          evidenceReferences: ["ref-2"],
        }),
      ).toThrow(HarnessError);
    });
  });

  // ==========================================================================
  // 4. Adversarial Convergence Limits & Pareto Arbitration Escalation
  // ==========================================================================
});
