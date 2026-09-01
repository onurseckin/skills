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


describe("Evidence Lifecycle - Deltas & Cross-Module Integration", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
    resetDefaultMotionVerificationEngine();
    resetDefaultEvidenceLifecycleEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
    resetDefaultMotionVerificationEngine();
    resetDefaultEvidenceLifecycleEngine();
  });

describe("Three-Tier Evidence Lifecycle Architecture", () => {
      it("registers artifacts, promotes to milestone anchors, and prunes superseded intermediates (Tier 3)", () => {
        const manager = new LifecycleManager(1);

        const artR1_1 = CompositeKeyParser.extractMetadata("auth_r1_login_default_1440x900", {
          sizeBytes: 1000,
        });
        const artR1_2 = CompositeKeyParser.extractMetadata("auth_r1_login_error_1440x900", {
          sizeBytes: 2000,
        });
        const artR2_1 = CompositeKeyParser.extractMetadata("auth_r2_login_default_1440x900", {
          sizeBytes: 1100,
        });

        manager.registerArtifact(artR1_1);
        manager.registerArtifact(artR1_2);
        manager.registerArtifact(artR2_1);

        // Promote artR1_1 to Milestone Anchor (Tier 2)
        const promoted = manager.promoteToMilestoneAnchor(artR1_1.keyString);
        expect(promoted.tier).toBe(2);
        expect(promoted.isMilestoneAnchor).toBe(true);

        const initialStats = manager.getStorageStats();
        expect(initialStats.tier1Count).toBe(2);
        expect(initialStats.tier2Count).toBe(1);
        expect(initialStats.totalActiveCount).toBe(3);

        // Advance to round 3:
        // Current: 3 (Tier 1)
        // Immediate previous: 2 (Tier 1)
        // Older: 1 (Tier 3 pruning for non-anchors). artR1_2 should be pruned, artR1_1 retained as Tier 2 anchor.
        const advanceRes = manager.advanceRound(3);
        expect(advanceRes.prunedKeys).toContain(artR1_2.keyString);
        expect(advanceRes.retainedKeys).toContain(artR1_1.keyString);
        expect(advanceRes.retainedKeys).toContain(artR2_1.keyString);

        expect(manager.getArtifact(artR1_2.keyString)).toBeUndefined();
        expect(manager.getArtifact(artR1_1.keyString)).toBeDefined();

        const finalStats = manager.getStorageStats();
        expect(finalStats.tier3PrunedCount).toBe(1);
        expect(finalStats.tier3PrunedSizeBytes).toBe(2000);
        expect(finalStats.tier2Count).toBe(1);
        expect(finalStats.tier1Count).toBe(1);
        expect(finalStats.totalActiveCount).toBe(2);
      });

      it("throws HarnessError on invalid round advancement or missing artifact promotion", () => {
        const manager = new LifecycleManager(2);
        expect(() => manager.advanceRound(1)).toThrow(HarnessError); // Non-advancing round
        expect(() => manager.promoteToMilestoneAnchor("non-existent-artifact")).toThrow(
          HarnessError,
        );
        expect(() => manager.registerArtifact(null as any)).toThrow(HarnessError);
      });
    });

    describe("Perceptual Difference Heatmaps & Lightweight Visual Delta Reporting", () => {
      it("computes visual delta and classifies severity correctly", () => {
        const comparator = new VisualDeltaComparator();

        expect(comparator.classifySeverity(0.0)).toBe("NONE");
        expect(comparator.classifySeverity(0.002)).toBe("MINOR");
        expect(comparator.classifySeverity(0.03)).toBe("SIGNIFICANT");
        expect(comparator.classifySeverity(0.1)).toBe("CRITICAL");

        const identical = comparator.computeDelta({
          baselineWidth: 1000,
          baselineHeight: 1000,
          candidateWidth: 1000,
          candidateHeight: 1000,
          totalPixels: 1000000,
          differingPixels: 0,
        });
        expect(identical.passed).toBe(true);
        expect(identical.severity).toBe("NONE");
        expect(identical.shiftDetected).toBe(false);

        const minorDiff = comparator.computeDelta({
          baselineWidth: 1000,
          baselineHeight: 1000,
          candidateWidth: 1000,
          candidateHeight: 1000,
          totalPixels: 1000000,
          differingPixels: 1000, // 0.1% diff
        });
        expect(minorDiff.passed).toBe(true);
        expect(minorDiff.severity).toBe("MINOR");

        const criticalDiff = comparator.computeDelta({
          baselineWidth: 1000,
          baselineHeight: 1000,
          candidateWidth: 1200, // Dimension shift!
          candidateHeight: 1000,
          totalPixels: 1000000,
          differingPixels: 80000, // 8.0% diff
        });
        expect(criticalDiff.passed).toBe(false);
        expect(criticalDiff.severity).toBe("CRITICAL");
        expect(criticalDiff.shiftDetected).toBe(true);
      });

      it("clusters spatially adjacent differing pixels into bounding boxes", () => {
        const comparator = new VisualDeltaComparator();
        const coords = [
          // Cluster 1 (around 10,10)
          { x: 10, y: 10 },
          { x: 12, y: 11 },
          { x: 15, y: 14 },
          // Cluster 2 (around 200,200)
          { x: 200, y: 200 },
          { x: 205, y: 202 },
        ];

        const clusters = comparator.clusterDifferingPixels(coords, 20);
        expect(clusters.length).toBe(2);
        expect(clusters[0].pixelCount).toBe(3);
        expect(clusters[1].pixelCount).toBe(2);
      });

      it("throws HarnessError on invalid delta comparator inputs", () => {
        const comparator = new VisualDeltaComparator();
        expect(() => comparator.computeDelta(null as any)).toThrow(HarnessError);
      });
    });

    describe("EvidenceLifecycleEngine Singleton", () => {
      it("manages singleton instance getters, setters, and resetters", () => {
        const engine1 = getDefaultEvidenceLifecycleEngine();
        const engine2 = getDefaultEvidenceLifecycleEngine();
        expect(engine1).toBe(engine2);

        const custom = new EvidenceLifecycleEngine();
        setDefaultEvidenceLifecycleEngine(custom);
        expect(getDefaultEvidenceLifecycleEngine()).toBe(custom);

        resetDefaultEvidenceLifecycleEngine();
        const fresh = getDefaultEvidenceLifecycleEngine();
        expect(fresh).not.toBe(custom);
      });
    });
  });

  // =========================================================================
  // 4. End-to-End Cross-Module Wave 2 Integration
  // =========================================================================

describe("Wave 2 Cross-Module Integration", () => {
    it("coordinates journey flow, motion pre-flight verification, and evidence artifact lifecycle", async () => {
      const browserEngine = getDefaultBrowserChoreographyEngine();
      const motionEngine = getDefaultMotionVerificationEngine();
      const evidenceEngine = getDefaultEvidenceLifecycleEngine();

      // Step 1: Execute Journey Flow
      const journeyResult = await browserEngine.journeys.executeJourney({
        id: "e2e-nav-motion-flow",
        name: "E2E Navigation & Motion Flow",
        initialRoute: "/dashboard",
        steps: [
          {
            id: "step-1",
            name: "Open Modal",
            route: "/dashboard",
            action: "click",
            targetSelector: "#btn-open-settings",
            expectedBreadcrumbs: ["App", "Dashboard"],
          },
        ],
      });
      expect(journeyResult.success).toBe(true);

      // Step 2: Verify Motion & Transition Pre-Flight
      const motionResult = motionEngine.preFlight.auditAnimation({
        animationName: "modal-fade-in",
        targetSelector: ".modal-backdrop",
        animatedProperties: ["opacity", "transform"],
        frameSamples: Array.from({ length: 60 }, (_, i) => ({
          timestampMs: i * 16.6,
          durationMs: 16.6,
        })),
        layoutShifts: [{ shiftScore: 0.0001 }],
      });
      expect(motionResult.passed).toBe(true);

      // Step 3: Optical Stability Check & Evidence Registration
      const artifactKey: CompositeArtifactKey = {
        epic: "settings",
        round: 1,
        route: "dashboard-modal",
        state: "open",
        viewport: "1440x900",
      };
      const keyString = evidenceEngine.parser.serialize(artifactKey, "");

      const stability = evidenceEngine.stabilityBarrier.evaluateStability(keyString, {
        inFlightRequests: 0,
        networkQuiescenceDurationMs: 600,
        fontsReady: true,
        unrenderedAssetCount: 0,
        activeAnimationsCount: 0,
        layoutShiftDelta: 0,
      });
      expect(stability.stable).toBe(true);

      const artifact = evidenceEngine.parser.extractMetadata(artifactKey, {
        sizeBytes: 450000,
        readinessToken: stability.readinessToken,
      });
      evidenceEngine.manager.registerArtifact(artifact);

      expect(evidenceEngine.manager.getArtifact(keyString)).toBeDefined();
    });
  });
