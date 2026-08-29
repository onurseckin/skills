export {
  detectLayoutShiftBetweenSnapshots,
  identifyRootCausingElements,
  calculateDistanceFraction,
  calculateImpactFraction,
  calculateLayoutShiftScore,
  clipRectToViewport,
  computeRectanglesUnionArea,
  DEFAULT_LAYOUT_SHIFT_OPTIONS,
  resolveLayoutShiftTrackerOptions,
  buildCumulativeLayoutShiftReport,
  groupSessionWindows,
  LayoutShiftTracker,
} from "./layout-shift-tracker/index.ts";

export type {
  CumulativeLayoutShiftReport,
  LayoutShiftEntry,
  LayoutShiftTrackerOptions,
  LayoutShiftWindow,
  ResolvedLayoutShiftTrackerOptions,
  UnstableElementDisplacement,
} from "./layout-shift-tracker/index.ts";
