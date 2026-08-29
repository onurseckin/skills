/**
 * @file index.ts
 * Subpixel Border Alignment & Hairline Artifact Detector Module
 */

export {
  CANONICAL_FRACTIONAL_DPR_SCALES,
  type AntiAliasingEdgeContrastResult,
  type DprEvaluation,
  type EdgeContrastEvaluation,
  type SubpixelBorderAnalysisResult,
  type SubpixelBorderDefect,
  type SubpixelBorderWidths,
  type SubpixelDriftEvaluation,
  type SubpixelDriftResult,
  type SubpixelElementBounds,
  type SubpixelElementInput,
  type SubpixelValidationOptions,
} from "./types.ts";

export {
  getPhysicalRoundingError,
  normalizeBorderWidths,
  parseTransformTranslations,
  snapToDevicePixels,
} from "./utils.ts";

export {
  evaluateAntiAliasingEdgeContrast,
  evaluateEdgeContrast,
  evaluateSubpixelDrift,
} from "./edge-evaluators.ts";

export {
  evaluateElementSubpixelPhysics,
  validateElementSubpixelPhysics,
  validateSubpixelBorders,
} from "./physics-evaluators.ts";
