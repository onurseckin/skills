export type {
  AABB,
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CaptureCookie,
  CaptureError,
  CaptureItemResult,
  CapturePageDriver,
  CaptureRunOptions,
  CaptureRunResult,
  CompanionManifest,
  DomPhysicsSnapshot,
  ExtractedComputedStyles,
  ExtractedElementMetrics,
  ExtractedElementPhysics,
  LayoutOverflowEntry,
  ResolvedSessionAuth,
  TextClippingEntry,
} from "./types.ts";

export {
  PNG_SIGNATURE,
  extractPngDimensions,
  isPngBuffer,
  validatePngBuffer,
  type PngDimensions,
} from "./png-ihdr-validator.ts";

export {
  CANONICAL_ROLES,
  SessionAuthResolver,
  createSessionAuthResolver,
} from "./session-auth-resolver.ts";

export {
  DOM_PHYSICS_EXTRACTION_SCRIPT,
  computeLayoutMetrics,
  createEmptyDomPhysicsSnapshot,
  extractDomPhysics,
} from "./dom-physics-extractor.ts";

export {
  DefaultFallbackBrowserProvider,
  createSyntheticPngBuffer,
  filterScreens,
  resolveCaptureOutputDir,
  resolveViewportsForScreen,
  runLiveCapture,
} from "./live-capture-runner/index.ts";

export {
  DEFAULT_LAYOUT_SHIFT_OPTIONS,
  LayoutShiftTracker,
  buildCumulativeLayoutShiftReport,
  calculateDistanceFraction,
  calculateImpactFraction,
  calculateLayoutShiftScore,
  clipRectToViewport,
  computeRectanglesUnionArea,
  detectLayoutShiftBetweenSnapshots,
  groupSessionWindows,
  identifyRootCausingElements,
  resolveLayoutShiftTrackerOptions,
  type CumulativeLayoutShiftReport,
  type LayoutShiftEntry,
  type LayoutShiftTrackerOptions,
  type LayoutShiftWindow,
  type ResolvedLayoutShiftTrackerOptions,
  type UnstableElementDisplacement,
} from "./layout-shift-tracker/index.ts";

export {
  DOM_EVENT_DISPATCH_SCRIPT,
  DEFAULT_DOM_SIMULATION_OPTIONS,
  DomEventSimulator,
  buildSyntheticInteractionPlan,
  classifyLayoutShift,
  resolveDomSimulationOptions,
  simulateDomEvent,
  type DomEventSimulationReport,
  type DomEventStepResult,
  type DomSimulationOptions,
  type ExpectedShiftBehavior,
  type ResolvedDomSimulationOptions,
  type SyntheticDomEvent,
  type SyntheticDomEventType,
  type UnexpectedShiftDefect,
} from "./dom-event-simulator/index.ts";
