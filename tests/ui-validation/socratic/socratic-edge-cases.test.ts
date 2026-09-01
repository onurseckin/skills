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


describe("Socratic Dialectic - Edge Cases & Nuances", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
    resetDefaultSocraticDialecticEngine();
  });

describe("12. Edge Cases, Query Filters & Manifest Verification Nuances", () => {
    it("should validate session ID setting on engines", () => {
      const socraticEngine = new SocraticDialecticEngine();
      expect(socraticEngine.getSessionId()).toBe("socratic-session-001");
      socraticEngine.setSessionId("new-session-id");
      expect(socraticEngine.getSessionId()).toBe("new-session-id");
      expect(socraticEngine.getMilestoneEngine().getSessionId()).toBe("new-session-id");
      expect(() => socraticEngine.setSessionId("")).toThrow(HarnessError);

      const lockEngine = new MilestoneLockEngine("init-session");
      expect(lockEngine.getSessionId()).toBe("init-session");
      lockEngine.setSessionId("updated-session");
      expect(lockEngine.getSessionId()).toBe("updated-session");
      expect(() => lockEngine.setSessionId("   ")).toThrow(HarnessError);
    });

    it("should filter challenges by round number and status", () => {
      const engine = new SocraticDialecticEngine();
      const c1 = engine.raiseChallenge({ roundNumber: 1, category: "cat1", thesis: "Thesis 1" });
      const c2 = engine.raiseChallenge({ roundNumber: 1, category: "cat2", thesis: "Thesis 2" });
      const c3 = engine.raiseChallenge({ roundNumber: 2, category: "cat3", thesis: "Thesis 3" });

      engine.submitDefense({
        challengeId: c1.challengeId,
        rationale: "Valid rationale for defending challenge 1 with evidence.",
        evidenceReferences: ["ref1"],
      });

      expect(engine.getChallenge(c1.challengeId)).toBe(c1);
      expect(engine.getChallenge("unknown-id")).toBeUndefined();

      const r1Challenges = engine.listChallenges({ roundNumber: 1 });
      expect(r1Challenges).toHaveLength(2);

      const r2Challenges = engine.listChallenges({ roundNumber: 2 });
      expect(r2Challenges).toHaveLength(1);

      const defendedChallenges = engine.listChallenges({ status: "DEFENDED" });
      expect(defendedChallenges).toHaveLength(1);
      expect(defendedChallenges[0].challengeId).toBe(c1.challengeId);

      const pendingChallenges = engine.listChallenges({ status: "PENDING" });
      expect(pendingChallenges).toHaveLength(2);
    });

    it("should allow sealing milestones with custom scopes", () => {
      const lockEngine = new MilestoneLockEngine("session-custom-scopes");
      const customScopes = ["custom.component.header", "custom.component.footer"];

      const manifest = lockEngine.sealMilestone({
        sessionId: "session-custom-scopes",
        roundNumber: 1,
        roundName: "Custom Macro",
        statePayload: { header: "present" },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
        customScopes,
      });

      expect(manifest.sealedScope).toEqual(customScopes);
      expect(lockEngine.getManifest(1)?.sealedScope).toEqual(customScopes);
    });

    it("should verify manifest integrity against an external state payload", () => {
      const lockEngine = new MilestoneLockEngine("session-external-verify");
      const originalPayload = { key: "value123", count: 42 };

      const manifest = lockEngine.sealMilestone({
        sessionId: "session-external-verify",
        roundNumber: 1,
        roundName: "Test Round",
        statePayload: originalPayload,
        challengeSummary: { total: 1, defended: 1, arbitrated: 0 },
      });

      // Match with identical external payload
      const resultMatch = lockEngine.verifyManifestIntegrity(manifest, { count: 42, key: "value123" });
      expect(resultMatch.isValid).toBe(true);
      expect(resultMatch.stateHashMatches).toBe(true);

      // Mismatch with modified external payload
      const resultMismatch = lockEngine.verifyManifestIntegrity(manifest, { count: 99, key: "value123" });
      expect(resultMismatch.isValid).toBe(false);
      expect(resultMismatch.stateHashMatches).toBe(false);
      expect(resultMismatch.discrepancyReason).toContain("Payload hash mismatch");
    });

    it("should handle InterRoundRegressionAuditor on empty sealed manifests", () => {
      const auditor = new InterRoundRegressionAuditor();
      const result = auditor.auditStateRegressions(2, { someKey: 1 }, []);
      expect(result.hasRegressions).toBe(false);
      expect(result.collateralDefects).toHaveLength(0);
      expect(result.regressionScore).toBe(0);
    });

    it("should reset SocraticDialecticEngine and MilestoneLockEngine cleanly", () => {
      const engine = new SocraticDialecticEngine();
      engine.raiseChallenge({ category: "cat", thesis: "Thesis" });
      expect(engine.listChallenges()).toHaveLength(1);

      engine.reset();
      expect(engine.listChallenges()).toHaveLength(0);
      expect(engine.getCurrentRoundNumber()).toBe(1);
      expect(engine.isComplete()).toBe(false);

      const lockEngine = new MilestoneLockEngine();
      lockEngine.sealMilestone({
        sessionId: "s",
        roundNumber: 1,
        roundName: "r1",
        statePayload: {},
        challengeSummary: { total: 0, defended: 0, arbitrated: 0 },
      });
      expect(lockEngine.listManifests()).toHaveLength(1);

      lockEngine.reset();
      expect(lockEngine.listManifests()).toHaveLength(0);
      expect(lockEngine.getHighestSealedRound()).toBe(0);
    });
  });
});
