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


describe("Milestone Locks - Optical Regression Exception Protocol", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

describe("9. Optical Regression Exception Protocol", () => {
    it("should reject non-empirical or weak regression proofs", () => {
      const lockEngine = new MilestoneLockEngine("session-proof-val");

      lockEngine.sealMilestone({
        sessionId: "session-proof-val",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      // 1. Empty proofId
      expect(() =>
        lockEngine.requestOpticalRegressionUnlock({
          proofId: "",
          sessionId: "session-proof-val",
          targetSealedRound: 1,
          currentActiveRound: 2,
          affectedScope: "layout.grid",
          rootCauseAnalysis: "Valid length root cause analysis here for testing purposes.",
          opticalDeltaMetric: 0.05,
          evidenceArtifactHash: computeSha256("artifact"),
          proposedRemediation: "Remediate grid properly",
        }),
      ).toThrow(HarnessError);

      // 2. Target round >= current active round
      expect(() =>
        lockEngine.requestOpticalRegressionUnlock({
          proofId: "p1",
          sessionId: "session-proof-val",
          targetSealedRound: 2,
          currentActiveRound: 2,
          affectedScope: "layout.grid",
          rootCauseAnalysis: "Valid length root cause analysis here for testing purposes.",
          opticalDeltaMetric: 0.05,
          evidenceArtifactHash: computeSha256("artifact"),
          proposedRemediation: "Remediate grid properly",
        }),
      ).toThrow(HarnessError);

      // 3. Short root cause analysis (< MIN_ROOT_CAUSE_ANALYSIS_LENGTH)
      expect(() =>
        lockEngine.requestOpticalRegressionUnlock({
          proofId: "p2",
          sessionId: "session-proof-val",
          targetSealedRound: 1,
          currentActiveRound: 2,
          affectedScope: "layout.grid",
          rootCauseAnalysis: "Short bug",
          opticalDeltaMetric: 0.05,
          evidenceArtifactHash: computeSha256("artifact"),
          proposedRemediation: "Remediate grid properly",
        }),
      ).toThrow(HarnessError);

      // 4. Non-positive optical delta metric
      expect(() =>
        lockEngine.requestOpticalRegressionUnlock({
          proofId: "p3",
          sessionId: "session-proof-val",
          targetSealedRound: 1,
          currentActiveRound: 2,
          affectedScope: "layout.grid",
          rootCauseAnalysis: "Valid length root cause analysis here for testing purposes.",
          opticalDeltaMetric: 0,
          evidenceArtifactHash: computeSha256("artifact"),
          proposedRemediation: "Remediate grid properly",
        }),
      ).toThrow(HarnessError);
    });

    it("should execute full unlock, remediation, and resealing lifecycle", () => {
      const lockEngine = new MilestoneLockEngine("session-opt-lifecycle");

      lockEngine.sealMilestone({
        sessionId: "session-opt-lifecycle",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { "layout.grid.columns": 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      const proof: EmpiricalRegressionProof = {
        proofId: "proof-007",
        sessionId: "session-opt-lifecycle",
        targetSealedRound: 1,
        currentActiveRound: 3,
        affectedScope: "layout.grid",
        rootCauseAnalysis:
          "Subpixel container jitter observed under 125% OS display scaling on Windows Chrome.",
        opticalDeltaMetric: 0.083,
        evidenceArtifactHash: computeSha256("screenshot:jitter-diff"),
        proposedRemediation: "Apply transform: translateZ(0) to force integer pixel rasterization.",
      };

      // Request unlock
      const token = lockEngine.requestOpticalRegressionUnlock(proof, { compensationCredit: 2 });
      expect(token.targetRound).toBe(1);
      expect(token.compensationCredit).toBe(2);
      expect(token.isConsumed).toBe(false);

      const unlockedManifest = lockEngine.getManifest(1);
      expect(unlockedManifest?.lockStatus).toBe("TEMPORARILY_UNLOCKED");

      // Reseal with remediated payload
      const remediatedPayload = {
        "layout.grid.columns": 12,
        "layout.grid.rasterization": "translateZ(0)",
      };

      const resealedManifest = lockEngine.resealMilestone(1, remediatedPayload, token);
      expect(resealedManifest.lockStatus).toBe("RESEALED");
      expect(resealedManifest.unlockHistory).toHaveLength(1);
      expect(resealedManifest.unlockHistory[0].tokenId).toBe(token.tokenId);
      expect(resealedManifest.statePayloadHash).toBe(computeSha256(remediatedPayload));

      // Attempting to reuse the consumed token throws INVALID_STATE
      expect(() =>
        lockEngine.assertScopeMutable({
          scope: "layout.grid",
          currentRound: 3,
          token,
        }),
      ).toThrow(HarnessError);
    });

    it("should reject expired unlock tokens", () => {
      const lockEngine = new MilestoneLockEngine("session-expire-test");

      lockEngine.sealMilestone({
        sessionId: "session-expire-test",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { grid: 12 },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      const proof: EmpiricalRegressionProof = {
        proofId: "proof-exp",
        sessionId: "session-expire-test",
        targetSealedRound: 1,
        currentActiveRound: 2,
        affectedScope: "layout.grid",
        rootCauseAnalysis: "Valid root cause analysis string that is sufficiently descriptive.",
        opticalDeltaMetric: 0.05,
        evidenceArtifactHash: computeSha256("artifact"),
        proposedRemediation: "Remediate grid properly",
      };

      // Issue token with negative expiration time (already expired)
      const token = lockEngine.requestOpticalRegressionUnlock(proof, { expirationMs: -1000 });

      expect(() =>
        lockEngine.validateUnlockToken(token, 1, "layout.grid"),
      ).toThrow(HarnessError);
    });
  });

  // ==========================================================================
  // 10. Singletons & Factory Functions
  // ==========================================================================
  describe("10. Singletons & Factory Functions", () => {
    it("should manage default singleton for SocraticDialecticEngine", () => {
      const defaultEngine1 = getDefaultSocraticDialecticEngine();
      const defaultEngine2 = getDefaultSocraticDialecticEngine();
      expect(defaultEngine1).toBe(defaultEngine2);

      const customEngine = new SocraticDialecticEngine({ sessionId: "custom-session" });
      setDefaultSocraticDialecticEngine(customEngine);
      expect(getDefaultSocraticDialecticEngine()).toBe(customEngine);

      resetDefaultSocraticDialecticEngine();
      const freshEngine = getDefaultSocraticDialecticEngine();
      expect(freshEngine).not.toBe(customEngine);
    });

    it("should manage default singleton for MilestoneLockEngine", () => {
      const defaultLock1 = getDefaultMilestoneLockEngine();
      const defaultLock2 = getDefaultMilestoneLockEngine();
      expect(defaultLock1).toBe(defaultLock2);

      const customLock = new MilestoneLockEngine("custom-lock-session");
      setDefaultMilestoneLockEngine(customLock);
      expect(getDefaultMilestoneLockEngine()).toBe(customLock);

      resetDefaultMilestoneLockEngine();
      const freshLock = getDefaultMilestoneLockEngine();
      expect(freshLock).not.toBe(customLock);
    });
  });

  // ==========================================================================
  // 11. End-to-End 5-Round Progressive Validation Convergence
  // ==========================================================================
});
