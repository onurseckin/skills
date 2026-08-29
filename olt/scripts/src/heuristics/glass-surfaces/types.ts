/**
 * @file types.ts
 * Type definitions for glass surface heuristics and APCA substrate analysis
 */

export interface ParsedRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface GlassSurfaceLayer {
  readonly selector: string;
  readonly backgroundColor?: string | undefined;
  readonly backdropFilter?: string | undefined;
  readonly webkitBackdropFilter?: string | undefined;
  readonly opacity?: number | undefined;
  readonly zIndex?: number | undefined;
  readonly blurPx?: number | undefined;
}

export interface GlassTextElement {
  readonly selector: string;
  readonly text?: string | undefined;
  readonly color?: string | undefined;
  readonly fontSize?: number | undefined;
  readonly fontWeight?: number | undefined;
}

export interface GlassSubstrateEvaluation {
  readonly substrateColor: ParsedRgba;
  readonly compositedBg: ParsedRgba;
  readonly apcaLc: number;
  readonly requiredLc: number;
  readonly passed: boolean;
}

export interface GlassSurfaceDefect {
  readonly id: string;
  readonly category:
    | "glass-apca-contrast"
    | "glass-blur-overdraw"
    | "glass-transparency-washout"
    | "glass-missing-blur"
    | "glass-luminosity-clash";
  readonly severity: "critical" | "serious" | "moderate" | "minor";
  readonly elementSelector: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface GlassStackAnalysisResult {
  readonly isCompliant: boolean;
  readonly layerCount: number;
  readonly cumulativeBlurPx: number;
  readonly effectiveLinearBlurPx: number;
  readonly effectiveLayerOpacity: number;
  readonly compositedColorLightSubstrate: ParsedRgba;
  readonly compositedColorDarkSubstrate: ParsedRgba;
  readonly substrates: {
    readonly light: GlassSubstrateEvaluation;
    readonly dark: GlassSubstrateEvaluation;
  };
  readonly worstCaseLc: number;
  readonly requiredLc: number;
  readonly defects: readonly GlassSurfaceDefect[];
  readonly warnings: readonly string[];
}
