/**
 * @file glass-surfaces.ts
 * Facade for Extended Glass Surface Heuristic Engine
 */

export {
  analyzeGlassSurfaces,
  calculateApcaLightnessContrast,
  calculateEffectiveCumulativeBlur,
  compositeRgba,
  extractBlurRadiusPx,
  getRequiredApcaLc,
  parseColorToRgba,
  simulateSubstrateContrasts,
  sRgbToLuminanceY,
} from "./glass-surfaces/index.ts";

export type {
  GlassStackAnalysisResult,
  GlassSubstrateEvaluation,
  GlassSurfaceDefect,
  GlassSurfaceLayer,
  GlassTextElement,
  ParsedRgba,
} from "./glass-surfaces/index.ts";
