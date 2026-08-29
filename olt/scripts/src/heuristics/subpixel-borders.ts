/**
 * @file subpixel-borders.ts
 * Facade for Subpixel Border Alignment & Hairline Artifact Detector
 */

export {
  CANONICAL_FRACTIONAL_DPR_SCALES,
  evaluateAntiAliasingEdgeContrast,
  evaluateEdgeContrast,
  evaluateElementSubpixelPhysics,
  evaluateSubpixelDrift,
  getPhysicalRoundingError,
  normalizeBorderWidths,
  parseTransformTranslations,
  snapToDevicePixels,
  validateElementSubpixelPhysics,
  validateSubpixelBorders,
} from "./subpixel-borders/index.ts";

export type {
  AntiAliasingEdgeContrastResult,
  DprEvaluation,
  EdgeContrastEvaluation,
  SubpixelBorderAnalysisResult,
  SubpixelBorderDefect,
  SubpixelBorderWidths,
  SubpixelDriftEvaluation,
  SubpixelDriftResult,
  SubpixelElementBounds,
  SubpixelElementInput,
  SubpixelValidationOptions,
} from "./subpixel-borders/index.ts";
