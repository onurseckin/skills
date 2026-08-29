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
} from "./layout-shift-tracker/index.ts";

export type {
  CumulativeLayoutShiftReport,
  LayoutShiftEntry,
  LayoutShiftTrackerOptions,
  LayoutShiftWindow,
  ResolvedLayoutShiftTrackerOptions,
  UnstableElementDisplacement,
} from "./layout-shift-tracker/index.ts";
