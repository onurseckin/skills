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


describe("Milestone Locks - Anti-Moving-Goalpost & Monotonic Convergence", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
  });

describe("7. Anti-Moving-Goalpost Invariant Enforcement", () => {
    it("should throw when trying to mutate sealed upstream scopes in later rounds without an unlock token", () => {
      const lockEngine = new MilestoneLockEngine("session-moving-goalpost");

      // Seal Round 1 (scopes include 'layout.grid', 'layout.landmarks')
      lockEngine.sealMilestone({
        sessionId: "session-moving-goalpost",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      // In Round 2, attempting to mutate layout.grid without a token must throw
      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.grid",
          currentRound: 2,
        }),
      ).toThrow(HarnessError);

      // In Round 3, attempting to mutate layout.landmarks must throw
      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.landmarks",
          currentRound: 3,
        }),
      ).toThrow(HarnessError);

      // Unsealed scopes (e.g. typography.scale in Round 2) are mutable
      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "typography.scale",
          currentRound: 2,
        }),
      ).not.toThrow();
    });

    it("should allow mutation of sealed scope when a valid, active Optical Regression token is provided", () => {
      const lockEngine = new MilestoneLockEngine("session-token-assert");

      lockEngine.sealMilestone({
        sessionId: "session-token-assert",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      // Request optical regression unlock for Round 1 layout.grid while in Round 3
      const proof: EmpiricalRegressionProof = {
        proofId: "proof-opt-001",
        sessionId: "session-token-assert",
        targetSealedRound: 1,
        currentActiveRound: 3,
        affectedScope: "layout.grid",
        rootCauseAnalysis:
          "High DPI rendering causes subpixel rounding error resulting in 1px gutter overflow in 3-column layout.",
        opticalDeltaMetric: 0.042,
        evidenceArtifactHash: computeSha256("artifact:diff-gutter-overflow"),
        proposedRemediation:
          "Recalibrate CSS grid fractions to use subpixel calc(100% / 3 - 16px) instead of raw 33.333%.",
      };

      const token = lockEngine.requestOpticalRegressionUnlock(proof);

      // With token, mutation is permitted for layout.grid
      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.grid",
          currentRound: 3,
          token,
        }),
      ).not.toThrow();

      // With token for layout.grid, attempting to mutate unapproved layout.landmarks throws PERMISSION_DENIED
      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.landmarks",
          currentRound: 3,
          token,
        }),
      ).toThrow(HarnessError);
    });
  });

  // ==========================================================================
  // 8. Monotonic Convergence Law
  // ==========================================================================
  describe("8. Monotonic Convergence Law", () => {
    it("should prohibit out-of-order milestone sealing", () => {
      const lockEngine = new MilestoneLockEngine("session-monotonic");

      // Attempting to seal Round 2 before Round 1 throws INVALID_STATE
      expect(() =>
        lockEngine.sealMilestone({
          sessionId: "session-monotonic",
          roundNumber: 2,
          roundName: "Typography",
          statePayload: { font: "Inter" },
          challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
        }),
      ).toThrow(HarnessError);

      // Seal Round 1 successfully
      lockEngine.sealMilestone({
        sessionId: "session-monotonic",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      // Attempting to seal Round 3 before Round 2 throws INVALID_STATE
      expect(() =>
        lockEngine.sealMilestone({
          sessionId: "session-monotonic",
          roundNumber: 3,
          roundName: "Color",
          statePayload: { color: "blue" },
          challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
        }),
      ).toThrow(HarnessError);
    });

    it("should throw when trying to advance past Round 5", () => {
      const engine = new SocraticDialecticEngine({ sessionId: "session-r5" });

      // Fast-forward through rounds 1 to 5 by raising and defending challenges
      for (let r = 1; r <= 4; r++) {
        const c1 = engine.raiseChallenge({ category: `c1-r${r}`, thesis: `Thesis 1 for Round ${r}` });
        const c2 = engine.raiseChallenge({ category: `c2-r${r}`, thesis: `Thesis 2 for Round ${r}` });
        engine.submitDefense({
          challengeId: c1.challengeId,
          rationale: `Substantive justification for round ${r} challenge 1 adherence.`,
          evidenceReferences: [`ref:r${r}-1`],
        });
        engine.submitDefense({
          challengeId: c2.challengeId,
          rationale: `Substantive justification for round ${r} challenge 2 adherence.`,
          evidenceReferences: [`ref:r${r}-2`],
        });
        engine.advanceRound({ skipRegressionAudit: true });
      }

      expect(engine.getCurrentRoundNumber()).toBe(5);

      // Round 5 advance (quota is 0)
      const finalAdvance = engine.advanceRound({ skipRegressionAudit: true });
      expect(finalAdvance.isFinalRoundCompleted).toBe(true);
      expect(finalAdvance.sessionCompleted).toBe(true);
      expect(engine.isComplete()).toBe(true);

      // Attempting to advance again throws INVALID_STATE
      expect(() => engine.advanceRound()).toThrow(HarnessError);
    });
  });

  // ==========================================================================
  // 9. Optical Regression Exception Protocol
  // ==========================================================================
});
