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


describe("Milestone Locks - Cryptographic SHA-256 State Hashing", () => {
  beforeEach(() => {
    resetDefaultMilestoneLockEngine();
  });

  afterEach(() => {
    resetDefaultMilestoneLockEngine();
  });

describe("6. Cryptographic SHA-256 State Hashing & Immutability Manifests", () => {
    it("should produce deterministic SHA-256 digests regardless of object key insertion order", () => {
      const objA = { z: 10, a: "hello", m: [3, 2, 1], nested: { y: "test", b: 42 } };
      const objB = { nested: { b: 42, y: "test" }, a: "hello", m: [3, 2, 1], z: 10 };

      const hashA = computeSha256(objA);
      const hashB = computeSha256(objB);

      expect(hashA).toBe(hashB);
      expect(hashA).toHaveLength(64);
      expect(canonicalJsonStringify(objA)).toBe(canonicalJsonStringify(objB));
    });

    it("should seal milestones with verifiable SHA-256 signatures and snapshots", () => {
      const lockEngine = new MilestoneLockEngine("session-test-sha");

      const payload = {
        grid: { columns: 12, gutter: 24 },
        landmarks: ["header", "main", "footer"],
      };

      const manifest = lockEngine.sealMilestone({
        sessionId: "session-test-sha",
        roundNumber: 1,
        roundName: "Macro-Layout & Structural Hierarchy",
        statePayload: payload,
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      expect(manifest.roundNumber).toBe(1);
      expect(manifest.lockStatus).toBe("SEALED");
      expect(manifest.statePayloadHash).toBe(computeSha256(payload));
      expect(manifest.manifestSignature).toHaveLength(64);

      // Verify integrity
      const integrity = lockEngine.verifyManifestIntegrity(manifest);
      expect(integrity.isValid).toBe(true);
      expect(integrity.signatureMatches).toBe(true);
      expect(integrity.stateHashMatches).toBe(true);
      expect(integrity.tamperingDetected).toBe(false);
    });

    it("should detect tampering when payload snapshot or signature is corrupted", () => {
      const lockEngine = new MilestoneLockEngine("session-tamper-test");

      const manifest = lockEngine.sealMilestone({
        sessionId: "session-tamper-test",
        roundNumber: 1,
        roundName: "Macro-Layout",
        statePayload: { layout: "clean" },
        challengeSummary: { total: 2, defended: 2, arbitrated: 0 },
      });

      // Create tampered manifest
      const tamperedManifest: ImmutabilityManifest = {
        ...manifest,
        statePayloadSnapshot: { layout: "TAMPERED_VALUE" },
      };

      const integrity = lockEngine.verifyManifestIntegrity(tamperedManifest);
      expect(integrity.isValid).toBe(false);
      expect(integrity.tamperingDetected).toBe(true);
      expect(integrity.stateHashMatches).toBe(false);

      // Mutate internal state in lockEngine to simulate tampered store
      (lockEngine as any).manifests.set(1, tamperedManifest);
      const allLocksReport = lockEngine.verifyAllMilestoneLocks();
      expect(allLocksReport.isAllValid).toBe(false);
      expect(allLocksReport.tamperedRounds).toContain(1);

      expect(() => lockEngine.assertIntegrity()).toThrow(HarnessError);
    });
  });

  // ==========================================================================
  // 7. Anti-Moving-Goalpost Invariant Enforcement
  // ==========================================================================
});
