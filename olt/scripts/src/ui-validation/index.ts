// Quarantine
export type {
  OpticalQuarantineInvariant, QuarantineCategory, ToolDescriptor, ToolInvocationContext,
  QuarantineCheckResult, BackdoorDetectionResult, QuarantineEnforcementResult, QuarantineAuditRecord,
} from "./quarantine/index.ts";
export {
  OPTICAL_QUARANTINE_INVARIANTS, PERMITTED_IMAGE_EXTENSIONS, FORBIDDEN_SOURCE_EXTENSIONS,
  AUTHORIZED_BROWSER_TOOLS, AUTHORIZED_VISUAL_TOOLS, AUTHORIZED_MESSAGING_TOOLS, FORBIDDEN_TOOLS,
  EVALUATE_SCRIPT_HOST_FS_PATTERNS, SHELL_INJECTION_PATTERNS, LOCAL_URL_BYPASS_PATTERNS,
  isOpticalValidatorRole, verifyCapability, detectBackdoorBypass, ToolQuarantineEngine,
  getDefaultQuarantineEngine, setDefaultQuarantineEngine, resetDefaultQuarantineEngine,
} from "./quarantine/index.ts";

export type {
  ApplicationEndpoints, RunningPortInfo, CookieTemplateSpec, PersonaDefinition,
  FeatureScope, DeductiveParameters, ExtractionValidationResult,
} from "./quarantine/index.ts";
export {
  CANONICAL_DEFAULT_PERSONAS, CANONICAL_FEATURE_SCOPES, CANONICAL_PUBLIC_ROUTES, CANONICAL_AUTHENTICATED_ROUTES,
  extractFromWorkspace, validateParameters, resolveEndpoint, getPersonasForFeature,
  getPublicRoutes, getAuthenticatedRoutes, getDefaultParameters, ParameterExtractor,
  getDefaultParameterExtractor, setDefaultParameterExtractor, resetDefaultParameterExtractor,
} from "./quarantine/index.ts";

export type {
  SessionCookie, LocalStorageEntry, BrowserStorageOrigin, BrowserStorageState,
  PersonaSessionContext, SessionDegradationCause, SessionDegradationInspectionParams,
  SessionDegradationResult, ReauthExecutionPlan, PermissionAuditExpectation,
  PersonaAccessEvaluation, PermissionBoundaryAuditResult,
} from "./quarantine/index.ts";
export {
  base64UrlEncode, base64UrlDecode, MOCK_JWT_SECRET, detectSessionDegradation,
  executeAutonomousReauthentication, simulatePermissionBoundary, IdentityGovernanceEngine,
  getDefaultIdentityGovernanceEngine, setDefaultIdentityGovernanceEngine, resetDefaultIdentityGovernanceEngine,
} from "./quarantine/index.ts";

// Data Layer Disambiguation
export type {
  SyntheticFixtureType, SyntheticFixture, SchemaFieldRule, PayloadSchema,
  PreFlightCertificationResult, RoutedDefectReceipt, VisualFoundationHandoffToken,
  HandoffVerificationResult, DisambiguationEvaluationResult,
} from "./data-layer/index.ts";
export {
  SYNTHETIC_FIXTURE_TYPES, computePayloadSha256, createDashboardTelemetryFixtures,
  createUserManagementFixtures, validatePayloadSchema, DataLayerPreFlightCertifier,
  DefectRouter, VisualFoundationHandoffGate, DisambiguationGatewayEngine,
  getDefaultDisambiguationGatewayEngine, setDefaultDisambiguationGatewayEngine, resetDefaultDisambiguationGatewayEngine,
} from "./data-layer/index.ts";

// Browser Choreography
export type {
  ZIndexLayer, ZIndexRange, ViewportSpecification, ViewportPresetName, CanonicalStressInputKey,
  JourneyActionType, JourneyStep, JourneyFlow, JourneyStepResult, BreadcrumbVerificationResult,
  JourneyFlowResult, JourneyStepHandlerContext, JourneyStepHandler, FormFieldType, FormFieldDescriptor,
  ValidationBannerInfo, OverflowInspectionResult, FormStressFieldResult, FormStressTestPlan,
  FormStressTestResult, FormFieldEvaluationInput, OverlayType, OverlayDescriptor, ZIndexHierarchyViolation,
  ElementBounds, ElementLayoutNode, BackdropOcclusionResult, OverlayDismissalErgonomicsResult,
  TouchHitbox, TouchHitboxResult, MobileMenuTransitionMetrics, MobileMenuTransitionResult,
  BreakpointLayoutMetrics, BreakpointReflowResult,
} from "./browser/index.ts";
export {
  Z_INDEX_HIERARCHY, Z_INDEX_LAYER_RANGES, STANDARD_VIEWPORTS, TOUCH_HITBOX_MINIMUMS,
  CANONICAL_STRESS_INPUTS, JourneyFlowEngine, FormStressExplorer, OverlayOrchestrator,
  ResponsiveReflowProber, BrowserChoreographyEngine, getDefaultBrowserChoreographyEngine,
  setDefaultBrowserChoreographyEngine, resetDefaultBrowserChoreographyEngine,
} from "./browser/index.ts";

// Motion Verification
export type {
  GpuAcceleratedProperty, LayoutTriggeringProperty, SpringPresetConfig, SpringPresetKey,
  SpringPresetName, FrameSample, LayoutShiftSample, AnimatedPropertyAudit,
  MotionHeadlessPreFlightInput, MotionHeadlessPreFlightResult, KeyframeSamplePoint,
  TemporalKeyframeInspectionInput, TemporalKeyframeInspectionResult, FocusRingMetrics,
  FocusRingInspectionResult, HoverLiftMetrics, HoverLiftInspectionResult, TrajectoryPoint,
  SpringPhysicsInspectionInput, SpringPhysicsInspectionResult,
} from "./motion/index.ts";
export {
  TARGET_FRAME_RATE, TARGET_FRAME_DURATION_MS, JANK_FRAME_THRESHOLD_MS, MAX_PERMISSIBLE_JANK_RATE,
  MAX_PERMISSIBLE_CLS, GPU_ACCELERATED_PROPERTIES, LAYOUT_TRIGGERING_PROPERTIES, SPRING_PRESETS,
  HeadlessMotionPreFlightAuditor, TemporalKeyframeStepSampler, MicrocraftInspector,
  MotionVerificationEngine, getDefaultMotionVerificationEngine, setDefaultMotionVerificationEngine,
  resetDefaultMotionVerificationEngine,
} from "./motion/index.ts";

// Evidence Lifecycle
export type {
  CompositeArtifactKey, EvidenceTier, ArtifactMetadata, OpticalStabilityInput,
  OpticalStabilityResult, EvidenceStorageStats, PixelDeltaSeverity, PixelCoordinate,
  BoundingBox, VisualDeltaInput, VisualDeltaReport,
} from "./evidence/index.ts";
export {
  CompositeKeyParser, OpticalStabilityBarrier, LifecycleManager, VisualDeltaComparator,
  EvidenceLifecycleEngine, getDefaultEvidenceLifecycleEngine, setDefaultEvidenceLifecycleEngine,
  resetDefaultEvidenceLifecycleEngine,
} from "./evidence/index.ts";

// Theming & Permutations
export type {
  ViewportProfileName, ViewportDimension, PermutationSurface, RgbColor,
  ContrastAuditTarget, ContrastAuditResult, SurfaceContrastReport, PermutationInspectionState,
  ThematicGateReport, ThemeFlashDetectionInput, ThemeFlashReport, DarkDepthInput, DarkDepthReport,
  HighContrastBoundaryInput, HighContrastBoundaryReport,
} from "./theming/index.ts";
export {
  PERMUTATION_THEMES, VIEWPORT_DIMENSIONS, THEME_PERMUTATION_GRID, PermutationGridManager,
  parseColorToRgb, calculateRelativeLuminance, calculateWcagContrastRatio, calculateApcaContrast,
  isWcagAaCompliant, isWcagAaaCompliant, isApcaCompliant, MathematicalContrastPreFilter,
  ThematicGateVerifier, detectThemeFlash, calibrateDarkDepth, validateHighContrastBoundaries,
  PermutationStagingEngine, getDefaultPermutationStagingEngine, setDefaultPermutationStagingEngine,
  resetDefaultPermutationStagingEngine,
} from "./theming/index.ts";

// Tokens & Aesthetics
export type {
  OpticalDimension, OpticalDimensionMeta, IndustryProfileId, AestheticProfile,
  UiElementDescriptor, UiDescriptor, OpticalViolation, SocraticCritiqueChallenge,
  AestheticEvaluationReport, SpacingTokenName, SpacingTokenValue, FontFamilyToken,
  FontSizeToken, FontWeightToken, LineHeightToken, LetterSpacingToken, ThemeMode,
  ColorRoleTokens, ColorRole, ShadowElevationToken, BorderRadiiToken, TransitionDurationToken,
  TransitionEasingToken, RawValueViolation, RawValueValidationResult, StyleAdjustmentRequest,
  TokenImmunityDefense, TokenCompositionDescriptor, CompositionRecommendation,
  CompositionEvaluationResult, TokenProposalStatus, TokenEvolutionProposal, TokenRegistrySnapshot,
} from "./tokens/index.ts";
export {
  OPTICAL_DIMENSIONS, OPTICAL_DIMENSION_METADATA, ENTERPRISE_ACCOUNTING_PROFILE,
  LUXURY_HOSPITALITY_PROFILE, FLEET_TELEMATICS_PROFILE, STANDARD_AESTHETIC_PROFILES,
  AestheticProfileEvaluator, getDefaultAestheticProfileEvaluator, setDefaultAestheticProfileEvaluator,
  resetDefaultAestheticProfileEvaluator, SPACING_TOKENS, VALID_SPACING_VALUES, TYPOGRAPHY_TOKENS,
  VALID_FONT_SIZES, VALID_FONT_WEIGHTS, VALID_LINE_HEIGHTS, COLOR_PALETTES, SHADOW_ELEVATIONS,
  BORDER_RADII, VALID_BORDER_RADII_VALUES, TRANSITION_TOKENS, VALID_TRANSITION_DURATIONS,
  RawValuePolicyValidator, validateZeroRawValues, TokenComplianceImmunity,
  CompositionalDialecticEngine, TokenEvolutionManager, TokenAuthorityEngine,
  getDefaultTokenAuthorityEngine, setDefaultTokenAuthorityEngine, resetDefaultTokenAuthorityEngine,
} from "./tokens/index.ts";

// Socratic Dialectic & Milestone Locks
export type {
  MilestoneLockStatus, UnlockRecord, ImmutabilityManifest, SealMilestoneInput,
  EmpiricalRegressionProof, OpticalRegressionUnlockToken, ManifestIntegrityResult,
  LockSystemIntegrityReport, ScopeMutationRequest, SocraticRoundNumber, SocraticRoundId,
  SocraticRoundDefinition, CognitiveChallengeSeverity, CognitiveChallengeStatus,
  DefenseRecord, CognitiveChallenge, CreateChallengeInput, DefenseSubmission,
  DefenseEvaluationResult, CollateralDefect, InterRoundAuditResult, CompetingForce,
  CandidateResolution, ParetoArbitrationInput, ParetoArbitrationDecision, RoundGateEvaluation,
  RoundAdvanceResult, SocraticSessionSummary, DialecticSessionOptions,
} from "./socratic/index.ts";
export {
  ROUND_SCOPES, DEFAULT_UNLOCK_TOKEN_EXPIRATION_MS, MIN_ROOT_CAUSE_ANALYSIS_LENGTH,
  canonicalJsonStringify, computeSha256, computeManifestSignature, requestOpticalRegressionUnlock,
  verifyRegressionProof, resealMilestone, verifyManifestIntegrity, verifyAllMilestoneLocks,
  assertIntegrity, MilestoneLockEngine, getDefaultMilestoneLockEngine, setDefaultMilestoneLockEngine,
  resetDefaultMilestoneLockEngine, MANDATORY_CHALLENGE_QUOTA_R1_R4, MAX_CONVERGENCE_CYCLES_PER_GATE,
  MIN_SUBSTANTIVE_DEFENSE_LENGTH, SOCRATIC_ROUNDS, SOCRATIC_ROUND_MAP, TRIVIAL_DEFENSE_PATTERNS,
  evaluateSubstantiveDefense, InterRoundRegressionAuditor, ParetoArbitrationEngine,
  raiseChallenge, submitDefense, escalateToParetoArbitration, evaluateRoundReadiness,
  auditInterRoundState, advanceRound, SocraticDialecticEngine, getDefaultSocraticDialecticEngine,
  setDefaultSocraticDialecticEngine, resetDefaultSocraticDialecticEngine,
} from "./socratic/index.ts";
