export {
  detectLayoutShiftBetweenSnapshots,
} from "./detector.ts";

export {
  identifyRootCausingElements,
} from "./exclusion.ts";

export {
  calculateDistanceFraction,
  calculateImpactFraction,
  calculateLayoutShiftScore,
  clipRectToViewport,
  computeRectanglesUnionArea,
} from "./geometry.ts";

export {
  DEFAULT_LAYOUT_SHIFT_OPTIONS,
  resolveLayoutShiftTrackerOptions,
} from "./options.ts";

export {
  buildCumulativeLayoutShiftReport,
  groupSessionWindows,
} from "./session-windows.ts";

export {
  LayoutShiftTracker,
} from "./tracker.ts";

export type {
  CumulativeLayoutShiftReport,
  LayoutShiftEntry,
  LayoutShiftTrackerOptions,
  LayoutShiftWindow,
  ResolvedLayoutShiftTrackerOptions,
  UnstableElementDisplacement,
} from "./types.ts";
