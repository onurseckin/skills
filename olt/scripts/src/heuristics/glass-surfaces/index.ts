/**
 * @file index.ts
 * Extended Glass Surface Heuristic Engine Module
 */

export type {
  GlassStackAnalysisResult,
  GlassSubstrateEvaluation,
  GlassSurfaceDefect,
  GlassSurfaceLayer,
  GlassTextElement,
  ParsedRgba,
} from "./types.ts";

export {
  calculateApcaLightnessContrast,
  compositeRgba,
  getRequiredApcaLc,
  parseColorToRgba,
  sRgbToLuminanceY,
} from "./color.ts";

export {
  calculateEffectiveCumulativeBlur,
  extractBlurRadiusPx,
} from "./blur-accumulator.ts";

export {
  analyzeGlassSurfaces,
  simulateSubstrateContrasts,
} from "./evaluator.ts";
