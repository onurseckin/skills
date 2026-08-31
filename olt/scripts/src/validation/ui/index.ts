export type {
  AestheticHarmonyInspection,
  BrowserLifecycleInvariants,
  ContainerHierarchyEvaluation,
  DescenderInspection,
  DualUiAuditResult,
  HierarchyElementInput,
  OpticalHierarchyInspection,
  OverflowInspection,
  PlaywrightJourneyResult,
  ScreenshotInspectionInput,
  TouchTargetInspection,
  UiCognitiveInspectionInput,
  UiCognitiveReport,
  UiMechanicInspectionInput,
  UiMechanicReport,
  UiViewportSpec,
  UiViewportTier,
} from "./types.ts";

export {
  ALL_4_VIEWPORT_TIERS,
  CANONICAL_4_VIEWPORTS,
  DEFAULT_SUBPIXEL_TOLERANCE_PX,
  DESCENDER_CHARS,
  MIN_SCREENSHOT_BYTES,
  MIN_TOUCH_HITBOX_PT,
  MIN_VISUAL_ENTROPY_SCORE,
  ROBOTIC_SUPERFICIAL_CRITIQUE_PATTERNS,
  SHELL_COMMAND_KEYWORDS,
} from "./constants.ts";

export { inspectAllTouchHitboxes, inspectTouchHitbox } from "./hitbox-detector.ts";
export { inspectAllOverflowElements, inspectHorizontalOverflow } from "./overflow-detector.ts";
export {
  calculateOpticalWeight,
  evaluateOpticalHierarchy,
  normalizeWeightMultiplier,
} from "./optical-hierarchy.ts";
export { inspectDescenderIntegrity } from "./descender-inspector.ts";
export { validateUiMechanic } from "./mechanic-validator.ts";
export { evaluateAestheticHarmony, validateUiCognitive } from "./cognitive-validator.ts";
export { evaluateDualUiGates, type DualUiEvaluationParams } from "./dual-gate-engine.ts";
