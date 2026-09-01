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


describe("Socratic Dialectic - Pareto Arbitration Escalation", () => {
  beforeEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

  afterEach(() => {
    resetDefaultSocraticDialecticEngine();
  });

describe("4. Adversarial Convergence & Pareto Arbitration Escalation", () => {
    it("should increment cycle count and escalate after 4 rejected defense attempts", () => {
      const engine = new SocraticDialecticEngine();
      const chall = engine.raiseChallenge({
        category: "contrast",
        thesis: "Text contrast ratio appears insufficient under dark mode theme.",
      });

      expect(chall.cyclesUsed).toBe(0);
      expect(chall.status).toBe("PENDING");

      // Attempt 1: Trivial rejection
      engine.submitDefense({ challengeId: chall.challengeId, rationale: "looks good" });
      expect(chall.cyclesUsed).toBe(1);
      expect(chall.status).toBe("REJECTED");

      // Attempt 2: Too short rejection
      engine.submitDefense({ challengeId: chall.challengeId, rationale: "fixed now" });
      expect(chall.cyclesUsed).toBe(2);
      expect(chall.status).toBe("REJECTED");

      // Attempt 3: No evidence rejection
      engine.submitDefense({
        challengeId: chall.challengeId,
        rationale: "Contrast was increased by changing color values to darker ones.",
      });
      expect(chall.cyclesUsed).toBe(3);
      expect(chall.status).toBe("REJECTED");

      // Attempt 4: 4th rejection triggers ESCALATED status
      engine.submitDefense({ challengeId: chall.challengeId, rationale: "lgtm" });
      expect(chall.cyclesUsed).toBe(4);
      expect(chall.status).toBe("ESCALATED");

      // Gate cannot unlock while challenge is ESCALATED
      const readiness = engine.evaluateRoundReadiness();
      expect(readiness.isGateUnlocked).toBe(false);
      expect(readiness.escalatedChallengesCount).toBe(1);
    });

    it("should arbitrate deadlocked challenge using Pareto Arbitration Engine and unblock gate", () => {
      const engine = new SocraticDialecticEngine();
      const chall1 = engine.raiseChallenge({
        category: "density-vs-legibility",
        thesis: "High data density table clashes with luxury hospitality aesthetic profile.",
      });

      // Push chall1 to 4 cycles
      for (let i = 0; i < 4; i++) {
        engine.submitDefense({ challengeId: chall1.challengeId, rationale: "ok" });
      }
      expect(chall1.status).toBe("ESCALATED");

      // Escalate to Pareto Arbitration
      const arbInput: ParetoArbitrationInput = {
        challengeId: chall1.challengeId,
        competingForces: [
          { force: "Information Density", weight: 0.5, argument: "Enterprise operators need 50 rows per screen." },
          { force: "Visual Luxury Breathing Room", weight: 0.5, argument: "Brand guidelines require 32px line heights." },
        ],
        candidateResolutions: [
          {
            id: "res-compact-toggle",
            description: "Provide user-configurable density toggle (Compact: 12px padding vs Spacious: 24px padding).",
            score: 95,
            tradeoffs: "Adds 1 UI toggle control in table header while preserving default luxury aesthetic.",
          },
          {
            id: "res-compromise-fixed",
            description: "Set fixed row height to 18px midway.",
            score: 70,
            tradeoffs: "Satisfies neither requirement fully.",
          },
        ],
      };

      const decision = engine.escalateToParetoArbitration(arbInput);
      expect(decision.winningResolutionId).toBe("res-compact-toggle");
      expect(decision.status).toBe("BINDING_RESOLVED");
      expect(decision.bindingDirectives.length).toBeGreaterThan(0);

      // Challenge is now DEFENDED via arbitration
      expect(chall1.status).toBe("DEFENDED");
      expect(chall1.defenseRecord?.isAccepted).toBe(true);
      expect(chall1.defenseRecord?.rationale).toContain("binding Pareto Arbitration");

      // Raise and defend second challenge to satisfy quota
      const chall2 = engine.raiseChallenge({
        category: "layout-structure",
        thesis: "Ensure table header sticks on scroll without layout jitter.",
      });
      engine.submitDefense({
        challengeId: chall2.challengeId,
        rationale: "Sticky table header is anchored using CSS position: sticky with z-index elevation token md.",
        evidenceReferences: ["token:z-index.md", "layout:table-sticky-test"],
      });

      // Gate is now unlocked
      const readiness = engine.evaluateRoundReadiness();
      expect(readiness.isGateUnlocked).toBe(true);
      expect(readiness.quotaMet).toBe(true);
    });

    it("should throw error when Pareto arbitration input is invalid", () => {
      const engine = new SocraticDialecticEngine();
      const chall = engine.raiseChallenge({ category: "test", thesis: "Thesis" });

      expect(() =>
        engine.escalateToParetoArbitration({
          challengeId: "wrong-id",
          competingForces: [{ force: "F1", weight: 1 }],
          candidateResolutions: [{ id: "r1", description: "d1", score: 80 }],
        }),
      ).toThrow(HarnessError);

      expect(() =>
        engine.escalateToParetoArbitration({
          challengeId: chall.challengeId,
          competingForces: [],
          candidateResolutions: [{ id: "r1", description: "d1", score: 80 }],
        }),
      ).toThrow(HarnessError);

      expect(() =>
        engine.escalateToParetoArbitration({
          challengeId: chall.challengeId,
          competingForces: [{ force: "F1", weight: 1 }],
          candidateResolutions: [],
        }),
      ).toThrow(HarnessError);
    });
  });

  // ==========================================================================
  // 5. Inter-Round Visual Regression Auditing & Collateral Defect Detection
  // ==========================================================================
});
