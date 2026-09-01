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


describe("Design System Tokens - Dialectic & Evolution Protocol", () => {
  beforeEach(() => {
    resetDefaultTokenAuthorityEngine();
  });

  afterEach(() => {
    resetDefaultTokenAuthorityEngine();
  });

describe("4. Constructive Compositional Dialectic Engine", () => {
    it("should approve harmonized token compositions", () => {
      const dialectic = new CompositionalDialecticEngine();
      const result = dialectic.evaluateComposition({
        componentName: "HeroHeading",
        hierarchyLevel: "h1",
        fontSize: "4xl",
        lineHeight: "tight",
        fontWeight: "bold",
      });

      expect(result.harmonized).toBe(true);
      expect(result.elevationScore).toBe(100);
      expect(result.recommendations.length).toBe(0);
    });

    it("should recommend elevations for fragmented heading line-height and undersized H1 font", () => {
      const dialectic = new CompositionalDialecticEngine();
      const result = dialectic.evaluateComposition({
        componentName: "MainTitle",
        hierarchyLevel: "h1",
        fontSize: "base", // 16px is too small for H1
        lineHeight: "loose", // 2.0 causes fragmentation in large headings
      });

      expect(result.harmonized).toBe(false);
      expect(result.elevationScore).toBeLessThan(80);
      expect(result.recommendations.length).toBe(2);

      const fontRec = result.recommendations.find((r) => r.category === "typographic_contrast");
      expect(fontRec).toBeDefined();
    });

    it("should recommend breathing room for crowded card containers", () => {
      const dialectic = new CompositionalDialecticEngine();
      const result = dialectic.evaluateComposition({
        componentName: "DashboardCard",
        hierarchyLevel: "card",
        spacingInner: "none",
        shadowElevation: "none",
        borderRadius: "none",
      });

      expect(result.harmonized).toBe(false);
      const spatialRec = result.recommendations.find((r) => r.category === "spatial_rhythm");
      expect(spatialRec?.suggestedComposition).toContain("md (16px) or lg (24px)");
    });
  });

  describe("5. Systemic Token Evolution Protocol", () => {
    it("should manage the full RFC proposal lifecycle from submission to Mind Auditor approval and propagation", () => {
      const evolution = new TokenEvolutionManager();

      // 1. Submit proposal
      const proposal = evolution.submitProposal({
        name: "Cockpit High-Density Micro Spacing",
        category: "spacing",
        proposedTokenName: "cockpit-compact",
        proposedTokenValue: 6,
        targetDomain: "Fleet Telematics",
        justification: "Dense gauge readouts require a 6px intermediate spacing step.",
        author: "Implementer Wave 3",
      });

      expect(proposal.id).toBe("RFC-TKN-0001");
      expect(proposal.status).toBe("PROPOSED");

      // 2. Review proposal (Approved by Mind Auditor)
      const approved = evolution.reviewProposal(
        proposal.id,
        "APPROVED",
        "Mind Auditor",
        "Systemic evaluation confirms 6px spacing is mathematically harmonious for telematics.",
      );
      expect(approved.status).toBe("APPROVED");
      expect(approved.reviewedBy).toBe("Mind Auditor");

      // 3. Propagate token
      const propagated = evolution.propagateToken(proposal.id);
      expect(propagated.status).toBe("PROPAGATED");

      // 4. Inspect active registry snapshot
      const registry = evolution.getActiveRegistry();
      expect(registry.customTokens.length).toBe(1);
      expect(registry.customTokens[0]?.proposedTokenName).toBe("cockpit-compact");
    });

    it("should reject invalid proposal submission or invalid state transitions", () => {
      const evolution = new TokenEvolutionManager();

      // Missing required field
      expect(() => {
        evolution.submitProposal({
          name: "",
          category: "spacing",
          proposedTokenName: "",
          proposedTokenValue: 0,
          targetDomain: "",
          justification: "",
          author: "",
        });
      }).toThrow(HarnessError);

      // Propagate non-approved proposal throws INVALID_STATE
      const proposal = evolution.submitProposal({
        name: "Test",
        category: "spacing",
        proposedTokenName: "test-token",
        proposedTokenValue: 10,
        targetDomain: "General",
        justification: "Testing",
        author: "Tester",
      });

      expect(() => {
        evolution.propagateToken(proposal.id);
      }).toThrow(HarnessError);

      // Review non-existent proposal throws NOT_FOUND
      expect(() => {
        evolution.reviewProposal("NON_EXISTENT", "APPROVED", "Auditor", "notes");
      }).toThrow(HarnessError);
    });

    it("should filter proposals by status and category", () => {
      const evolution = new TokenEvolutionManager();

      evolution.submitProposal({
        name: "Proposal 1",
        category: "spacing",
        proposedTokenName: "sp-1",
        proposedTokenValue: 6,
        targetDomain: "Domain 1",
        justification: "Justification 1",
        author: "Author 1",
      });

      const p2 = evolution.submitProposal({
        name: "Proposal 2",
        category: "color",
        proposedTokenName: "col-1",
        proposedTokenValue: "#112233",
        targetDomain: "Domain 2",
        justification: "Justification 2",
        author: "Author 2",
      });

      evolution.reviewProposal(p2.id, "APPROVED", "Auditor", "ok");

      const spacingProposals = evolution.listProposals({ category: "spacing" });
      expect(spacingProposals.length).toBe(1);

      const approvedProposals = evolution.listProposals({ status: "APPROVED" });
      expect(approvedProposals.length).toBe(1);
      expect(approvedProposals[0]?.id).toBe(p2.id);
    });
  });

  describe("6. Token Authority Engine & Singletons", () => {
    it("should manage default singleton instance", () => {
      const defaultEngine = getDefaultTokenAuthorityEngine();
      expect(defaultEngine).toBeInstanceOf(TokenAuthorityEngine);
      expect(defaultEngine.immunity).toBeInstanceOf(TokenComplianceImmunity);
      expect(defaultEngine.policyValidator).toBeInstanceOf(RawValuePolicyValidator);

      const customEngine = new TokenAuthorityEngine();
      setDefaultTokenAuthorityEngine(customEngine);
      expect(getDefaultTokenAuthorityEngine()).toBe(customEngine);

      resetDefaultTokenAuthorityEngine();
      expect(getDefaultTokenAuthorityEngine()).not.toBe(customEngine);
    });
  });
});
