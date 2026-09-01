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


describe("Browser Choreography - Journey Flows & Breadcrumbs", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

describe("Active Journey Flows & Breadcrumb Continuity", () => {
      it("verifies breadcrumb continuity matching and mismatch detection", () => {
        const engine = new JourneyFlowEngine();
        const expected = ["Home", "Settings", "Security", "2FA"];
        const exactMatch = ["Home", "Settings", "Security", "2FA"];
        const missing = ["Home", "Settings"];
        const extra = ["Home", "Settings", "Security", "2FA", "Logs"];
        const outOfOrder = ["Home", "Security", "Settings", "2FA"];

        const matchRes = engine.verifyBreadcrumbContinuity(expected, exactMatch);
        expect(matchRes.match).toBe(true);
        expect(matchRes.missingBreadcrumbs.length).toBe(0);

        const missingRes = engine.verifyBreadcrumbContinuity(expected, missing);
        expect(missingRes.match).toBe(false);
        expect(missingRes.missingBreadcrumbs).toEqual(["Security", "2FA"]);

        const extraRes = engine.verifyBreadcrumbContinuity(expected, extra);
        expect(extraRes.match).toBe(false);
        expect(extraRes.unexpectedBreadcrumbs).toEqual(["Logs"]);

        const orderRes = engine.verifyBreadcrumbContinuity(expected, outOfOrder);
        expect(orderRes.match).toBe(false);
      });

      it("executes a complete multi-step journey flow successfully", async () => {
        const engine = new JourneyFlowEngine();
        const flow: JourneyFlow = {
          id: "checkout-journey",
          name: "Checkout Purchase Flow",
          initialRoute: "/cart",
          steps: [
            {
              id: "s1",
              name: "Review Cart",
              route: "/cart",
              action: "navigate",
              expectedBreadcrumbs: ["Shop", "Cart"],
            },
            {
              id: "s2",
              name: "Enter Shipping",
              route: "/checkout/shipping",
              action: "input",
              expectedBreadcrumbs: ["Shop", "Cart", "Shipping"],
            },
            {
              id: "s3",
              name: "Confirm Order",
              route: "/checkout/confirmation",
              action: "click",
              expectedBreadcrumbs: ["Shop", "Cart", "Confirmation"],
            },
          ],
        };

        const result = await engine.executeJourney(flow, async (ctx) => {
          return {
            breadcrumbsObserved: ctx.step.expectedBreadcrumbs,
            actualRoute: ctx.step.route,
          };
        });

        expect(result.success).toBe(true);
        expect(result.executedSteps.length).toBe(3);
        expect(result.executedSteps.every((s) => s.status === "PASSED")).toBe(true);
        expect(result.breadcrumbContinuityPassed).toBe(true);
        expect(result.violations.length).toBe(0);
      });

      it("handles step failure in journey flow and skips subsequent steps", async () => {
        const engine = new JourneyFlowEngine();
        const flow: JourneyFlow = {
          id: "auth-journey",
          name: "Authentication Journey",
          initialRoute: "/login",
          steps: [
            { id: "s1", name: "Visit Login", route: "/login", action: "navigate" },
            { id: "s2", name: "Submit Form", route: "/login", action: "click" },
            { id: "s3", name: "Dashboard", route: "/dashboard", action: "navigate" },
          ],
        };

        const result = await engine.executeJourney(flow, async (ctx) => {
          if (ctx.step.id === "s2") {
            return { error: "Form submission timed out" };
          }
          return {};
        });

        expect(result.success).toBe(false);
        expect(result.failedStep?.stepId).toBe("s2");
        expect(result.executedSteps[0].status).toBe("PASSED");
        expect(result.executedSteps[1].status).toBe("FAILED");
        expect(result.executedSteps[2].status).toBe("SKIPPED");
        expect(result.violations.length).toBe(1);
      });

      it("handles step handler thrown exceptions gracefully", async () => {
        const engine = new JourneyFlowEngine();
        const flow: JourneyFlow = {
          id: "error-journey",
          name: "Error Journey",
          initialRoute: "/start",
          steps: [{ id: "step-err", name: "Crash Step", route: "/crash", action: "custom" }],
        };

        const result = await engine.executeJourney(flow, async () => {
          throw new Error("Simulated browser session crash");
        });

        expect(result.success).toBe(false);
        expect(result.executedSteps[0].status).toBe("FAILED");
        expect(result.executedSteps[0].error).toContain("Simulated browser session crash");
      });

      it("throws HarnessError on invalid journey flow definitions", async () => {
        const engine = new JourneyFlowEngine();
        await expect(engine.executeJourney(null as any)).rejects.toThrow(HarnessError);
        await expect(
          engine.executeJourney({ id: "empty", name: "Empty", initialRoute: "/", steps: [] }),
        ).rejects.toThrow(HarnessError);
        expect(() => engine.verifyBreadcrumbContinuity(null as any, [])).toThrow(HarnessError);
      });
    });
});
