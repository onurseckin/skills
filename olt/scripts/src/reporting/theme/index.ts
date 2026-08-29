/**
 * Theme Contrast Matrix and Evaluation Subsystem Facade
 */
export {
  THEME_MODES,
  type ThemeMode,
  CONTRAST_STANDARDS,
  type ContrastStandard,
  type RgbaColor,
  type ElementThemePair,
  type ContrastEvaluation,
  type ThemeContrastElementResult,
  type ThemeContrastMatrix,
  type RegressionSeverity,
  type ThemeRegressionFinding,
  type MultiThemeComparisonReport,
} from "./types.ts";
export {
  isValidColor,
  parseRgb,
  compositeRgb,
  calculateRelativeLuminance,
  calculateWcagContrast,
  calculateApcaContrast,
} from "./color-space.ts";
export { evaluateThemeContrastMatrix } from "./evaluation.ts";
export { formatThemeContrastMatrixMarkdown } from "./render.ts";
