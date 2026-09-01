// @ts-nocheck
export type {
  ViewportProfileName,
  ViewportDimension,
  PermutationSurface,
  RgbColor,
  ContrastAuditTarget,
  ContrastAuditResult,
  SurfaceContrastReport,
  PermutationInspectionState,
  ThematicGateReport,
  ThemeFlashDetectionInput,
  ThemeFlashReport,
  DarkDepthInput,
  DarkDepthReport,
  HighContrastBoundaryInput,
  HighContrastBoundaryReport,
} from "./types.ts";

export {
  PERMUTATION_THEMES,
  VIEWPORT_DIMENSIONS,
  THEME_PERMUTATION_GRID,
} from "./types.ts";

export { PermutationGridManager } from "./permutation-grid.ts";
export {
  parseColorToRgb,
  calculateRelativeLuminance,
  calculateWcagContrastRatio,
  calculateApcaContrast,
  isWcagAaCompliant,
  isWcagAaaCompliant,
  isApcaCompliant,
} from "./contrast-math.ts";
export { MathematicalContrastPreFilter } from "./contrast-prefilter.ts";
export { ThematicGateVerifier } from "./thematic-gate.ts";
export {
  detectThemeFlash,
  calibrateDarkDepth,
  validateHighContrastBoundaries,
} from "./theming-detectors.ts";

export {
  PermutationStagingEngine,
  getDefaultPermutationStagingEngine,
  setDefaultPermutationStagingEngine,
  resetDefaultPermutationStagingEngine,
} from "./engine.ts";
