import type { ElementBoundingBox } from "../types.ts";

/**
 * Geometric definition of an element's focus ring and its surrounding physical context.
 */
export interface FocusRingGeometry {
  /**
   * Bounding box of the focused element in CSS pixels.
   */
  readonly elementBounds: ElementBoundingBox;

  /**
   * Border radius of the inner element in CSS pixels ($R_{inner}$).
   */
  readonly elementBorderRadius: number;

  /**
   * Focus ring outline offset or padding/gap from the element edge ($P$) in CSS pixels.
   */
  readonly ringOffset: number;

  /**
   * Stroke width / thickness of the focus ring outline in CSS pixels ($W$).
   */
  readonly ringWidth: number;

  /**
   * Actual rendered or configured corner radius of the focus ring ($R_{outer}$) in CSS pixels.
   */
  readonly ringRadius?: number;

  /**
   * CSS color string of the focus ring (e.g. hex, rgb, rgba, hsl, named).
   */
  readonly ringColor?: string;

  /**
   * CSS color string of the adjacent/underlying background.
   */
  readonly backgroundColor?: string;

  /**
   * Device Pixel Ratio of the display (e.g. 1.0, 1.25, 1.5, 2.0, 3.0).
   */
  readonly dpr?: number;

  /**
   * Clipping or container bounds that may clip the focus ring.
   */
  readonly clippingBounds?: ElementBoundingBox;

  /**
   * Element selector or identifier for defect attribution.
   */
  readonly selector?: string;

  /**
   * Optical curvature smoothing factor (0.0 for Euclidean circle, 1.0 for full squircle).
   */
  readonly opticalCurvatureSmoothing?: number;
}

/**
 * Detailed evaluation of nested concentric corners.
 */
export interface ConcentricCornerEvaluation {
  readonly innerRadius: number;
  readonly padding: number;
  readonly actualOuterRadius: number;
  readonly expectedOuterRadius: number;
  readonly delta: number;
  readonly isConcentric: boolean;
  readonly tolerancePx: number;
  readonly opticalCorrection: number;
  readonly details: string;
}

/**
 * Defect categories specific to focus ring geometry, snapping, and optics.
 */
export type FocusRingDefectType =
  | "concentric-mismatch"
  | "subpixel-misalignment"
  | "insufficient-contrast"
  | "clipping-overflow"
  | "optical-distortion";

/**
 * Structured defect item emitted during focus ring validation.
 */
export interface FocusRingDefect {
  readonly id: string;
  readonly type: FocusRingDefectType;
  readonly message: string;
  readonly severity: "critical" | "serious" | "moderate" | "minor";
  readonly suggestedRemediation: string;
  readonly metrics: Readonly<Record<string, number | string | boolean>>;
}

/**
 * Configuration options for optical snapping and concentric validation.
 */
export interface OpticalSnappingOptions {
  /**
   * Target device pixel ratio for evaluation. Defaults to 1.0 (or uses ring.dpr).
   */
  readonly dpr?: number;

  /**
   * Array of DPR scales to test for subpixel snapping artifacts.
   * Defaults to [1.0, 1.25, 1.5, 2.0, 3.0].
   */
  readonly supportedDprScales?: readonly number[];

  /**
   * Minimum contrast ratio required between focus ring and background.
   * Defaults to 3.0 (WCAG 2.1 Non-text Contrast requirement).
   */
  readonly targetContrast?: number;

  /**
   * Geometric tolerance in CSS pixels for concentricity checks.
   * Defaults to 1.0px.
   */
  readonly tolerancePx?: number;

  /**
   * Subpixel snapping tolerance in physical pixels.
   * Defaults to 0.05.
   */
  readonly subpixelTolerance?: number;

  /**
   * Superellipse curvature exponent for squircle evaluation (default 4.0).
   */
  readonly curvatureExponent?: number;

  /**
   * Whether to check for container clipping artifacts.
   * Defaults to true.
   */
  readonly checkClipping?: boolean;
}

/**
 * Physical pixel snapping evaluation across a specific DPR scale.
 */
export interface DprSnapEvaluation {
  readonly dpr: number;
  readonly physicalRingX: number;
  readonly physicalRingY: number;
  readonly physicalRingWidth: number;
  readonly physicalRingHeight: number;
  readonly physicalThickness: number;
  readonly physicalOffset: number;
  readonly isPhysicalIntegerAligned: boolean;
  readonly subpixelFractionX: number;
  readonly subpixelFractionY: number;
  readonly subpixelFractionThickness: number;
  readonly subpixelFractionOffset: number;
  readonly snappedCssBounds: ElementBoundingBox;
}

/**
 * Curvature and non-Euclidean optical smoothing metrics.
 */
export interface OpticalCurvatureMetrics {
  readonly innerRadius: number;
  readonly ringOffset: number;
  readonly outerRadius: number;
  readonly curvatureExponent: number;
  readonly smoothingFactor: number;
  readonly nonEuclideanDelta: number;
  readonly cornerArcLengthCorrection: number;
  readonly hasG2Continuity: boolean;
}

/**
 * Complete result of the optical ring snapping and concentric geometry validation.
 */
export interface OpticalSnapResult {
  readonly passed: boolean;
  readonly concentricEvaluation: ConcentricCornerEvaluation;
  readonly snappedRingBounds: ElementBoundingBox;
  readonly dprScaleResults: readonly DprSnapEvaluation[];
  readonly contrastAudit: {
    readonly contrastRatio: number;
    readonly passes: boolean;
  };
  readonly isClipped: boolean;
  readonly clippingOverlap?: {
    readonly topOverflow: number;
    readonly rightOverflow: number;
    readonly bottomOverflow: number;
    readonly leftOverflow: number;
  };
  readonly opticalCurvatureMetrics: OpticalCurvatureMetrics;
  readonly defects: readonly FocusRingDefect[];
}

/**
 * RGBA color representation.
 */
export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const NAMED_COLORS: Readonly<Record<string, RgbaColor>> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  currentcolor: { r: 0, g: 0, b: 0, a: 1 },
  red: { r: 239, g: 68, b: 68, a: 1 },
  blue: { r: 37, g: 99, b: 235, a: 1 },
  green: { r: 34, g: 197, b: 94, a: 1 },
  yellow: { r: 234, g: 179, b: 8, a: 1 },
  cyan: { r: 6, g: 182, b: 212, a: 1 },
  magenta: { r: 217, g: 70, b: 239, a: 1 },
  gray: { r: 107, g: 114, b: 128, a: 1 },
  grey: { r: 107, g: 114, b: 128, a: 1 },
  silver: { r: 203, g: 213, b: 225, a: 1 },
  navy: { r: 30, g: 58, b: 138, a: 1 },
  teal: { r: 13, g: 148, b: 136, a: 1 },
  purple: { r: 147, g: 51, b: 234, a: 1 },
  orange: { r: 249, g: 115, b: 22, a: 1 },
  indigo: { r: 99, g: 102, b: 241, a: 1 },
  violet: { r: 139, g: 92, b: 246, a: 1 },
  pink: { r: 236, g: 72, b: 153, a: 1 },
  lime: { r: 132, g: 204, b: 22, a: 1 },
  emerald: { r: 16, g: 185, b: 129, a: 1 },
  amber: { r: 245, g: 158, b: 11, a: 1 },
  rose: { r: 244, g: 63, b: 94, a: 1 },
  slate: { r: 100, g: 116, b: 139, a: 1 },
  zinc: { r: 113, g: 113, b: 122, a: 1 },
  neutral: { r: 115, g: 115, b: 115, a: 1 },
  stone: { r: 120, g: 113, b: 108, a: 1 },
};

function hslToRgb(h: number, s: number, l: number): { readonly r: number; readonly g: number; readonly b: number } {
  const normH = ((h % 360) + 360) % 360;
  const normS = Math.max(0, Math.min(1, s / 100));
  const normL = Math.max(0, Math.min(1, l / 100));

  const c = (1 - Math.abs(2 * normL - 1)) * normS;
  const x = c * (1 - Math.abs(((normH / 60) % 2) - 1));
  const m = normL - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (normH >= 0 && normH < 60) {
    rPrime = c;
    gPrime = x;
    bPrime = 0;
  } else if (normH >= 60 && normH < 120) {
    rPrime = x;
    gPrime = c;
    bPrime = 0;
  } else if (normH >= 120 && normH < 180) {
    rPrime = 0;
    gPrime = c;
    bPrime = x;
  } else if (normH >= 180 && normH < 240) {
    rPrime = 0;
    gPrime = x;
    bPrime = c;
  } else if (normH >= 240 && normH < 300) {
    rPrime = x;
    gPrime = 0;
    bPrime = c;
  } else {
    rPrime = c;
    gPrime = 0;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

/**
 * Parse any standard CSS color string into RGBA components.
 */
export function parseCssColor(colorStr?: string): RgbaColor | null {
  if (!colorStr) return null;
  const trimmed = colorStr.trim().toLowerCase();

  const named = NAMED_COLORS[trimmed];
  if (named) return named;

  // Hex color (#rgb, #rgba, #rrggbb, #rrggbbaa)
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const h0 = hex[0];
      const h1 = hex[1];
      const h2 = hex[2];
      if (h0 !== undefined && h1 !== undefined && h2 !== undefined) {
        return {
          r: parseInt(h0 + h0, 16),
          g: parseInt(h1 + h1, 16),
          b: parseInt(h2 + h2, 16),
          a: 1,
        };
      }
    }
    if (hex.length === 4) {
      const h0 = hex[0];
      const h1 = hex[1];
      const h2 = hex[2];
      const h3 = hex[3];
      if (h0 !== undefined && h1 !== undefined && h2 !== undefined && h3 !== undefined) {
        return {
          r: parseInt(h0 + h0, 16),
          g: parseInt(h1 + h1, 16),
          b: parseInt(h2 + h2, 16),
          a: parseInt(h3 + h3, 16) / 255,
        };
      }
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }

  // RGB / RGBA
  const rgbMatch = trimmed.match(/^rgba?\(\s*([\d.]+)\s*(?:,|\s+)\s*([\d.]+)\s*(?:,|\s+)\s*([\d.]+)(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/i);
  if (rgbMatch) {
    const m1 = rgbMatch[1];
    const m2 = rgbMatch[2];
    const m3 = rgbMatch[3];
    const m4 = rgbMatch[4];
    if (m1 !== undefined && m2 !== undefined && m3 !== undefined) {
      const r = Math.min(255, Math.max(0, parseFloat(m1)));
      const g = Math.min(255, Math.max(0, parseFloat(m2)));
      const b = Math.min(255, Math.max(0, parseFloat(m3)));
      let a = 1;
      if (m4 !== undefined) {
        a = m4.endsWith("%") ? parseFloat(m4) / 100 : parseFloat(m4);
        a = Math.min(1, Math.max(0, a));
      }
      return { r, g, b, a };
    }
  }

  // HSL / HSLA
  const hslMatch = trimmed.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*(?:,|\s+)\s*([\d.]+)%\s*(?:,|\s+)\s*([\d.]+)%(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/i);
  if (hslMatch) {
    const m1 = hslMatch[1];
    const m2 = hslMatch[2];
    const m3 = hslMatch[3];
    const m4 = hslMatch[4];
    if (m1 !== undefined && m2 !== undefined && m3 !== undefined) {
      const h = parseFloat(m1);
      const s = parseFloat(m2);
      const l = parseFloat(m3);
      const rgb = hslToRgb(h, s, l);
      let a = 1;
      if (m4 !== undefined) {
        a = m4.endsWith("%") ? parseFloat(m4) / 100 : parseFloat(m4);
        a = Math.min(1, Math.max(0, a));
      }
      return { r: rgb.r, g: rgb.g, b: rgb.b, a };
    }
  }

  return null;
}

function compositeColorOver(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = Math.max(0, Math.min(1, foreground.a));
  if (alpha >= 1) return foreground;

  const r = Math.round(foreground.r * alpha + background.r * (1 - alpha));
  const g = Math.round(foreground.g * alpha + background.g * (1 - alpha));
  const b = Math.round(foreground.b * alpha + background.b * (1 - alpha));
  const a = alpha + background.a * (1 - alpha);

  return { r, g, b, a };
}

function srgbChannelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function calculateWcagLuminance(color: RgbaColor): number {
  const rLin = srgbChannelToLinear(color.r);
  const gLin = srgbChannelToLinear(color.g);
  const bLin = srgbChannelToLinear(color.b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

function getSubpixelFraction(val: number): number {
  const frac = Math.abs(val % 1);
  return frac > 0.5 ? 1 - frac : frac;
}

/**
 * Calculates the mathematically concentric outer radius: $R_{outer} = R_{inner} + P$.
 * Handles zero and negative values gracefully.
 *
 * @param innerRadius The corner radius of the inner element ($R_{inner}$).
 * @param padding The padding or gap distance ($P$).
 * @returns The calculated outer corner radius ($R_{outer}$).
 */
export function calculateConcentricRadius(innerRadius: number, padding: number): number {
  return Math.max(0, innerRadius + padding);
}

/**
 * Validates nested concentric corners against the ideal geometric rule ($R_{outer} = R_{inner} + P$).
 *
 * @param outerRadius Actual corner radius of the outer container/focus ring.
 * @param innerRadius Corner radius of the inner element.
 * @param padding Padding or offset distance between inner and outer contours.
 * @param tolerancePx Acceptable deviation tolerance in CSS pixels (default: 1.0px).
 * @returns Comprehensive evaluation containing concentricity verdict, delta, and optical compensation metrics.
 */
export function validateNestedConcentricCorners(
  outerRadius: number,
  innerRadius: number,
  padding: number,
  tolerancePx = 1.0
): ConcentricCornerEvaluation {
  const expectedOuterRadius = calculateConcentricRadius(innerRadius, padding);
  const delta = Math.abs(outerRadius - expectedOuterRadius);
  const isConcentric = delta <= tolerancePx;

  // Diagonal optical compensation: along the 45-deg corner diagonal, the offset grows by (sqrt(2) - 1) * P
  const opticalCorrection = Math.round((Math.SQRT2 - 1) * Math.max(0, padding) * 1000) / 1000;

  const details = isConcentric
    ? `Corners are concentric within tolerance: outer radius is ${outerRadius}px (expected ${expectedOuterRadius}px, delta ${delta.toFixed(2)}px <= ${tolerancePx}px tolerance).`
    : `Concentric corner mismatch: outer radius is ${outerRadius}px but expected ${expectedOuterRadius}px (inner radius ${innerRadius}px + padding/offset ${padding}px). Delta is ${delta.toFixed(2)}px (exceeds ${tolerancePx}px tolerance).`;

  return {
    innerRadius,
    padding,
    actualOuterRadius: outerRadius,
    expectedOuterRadius,
    delta: Math.round(delta * 1000) / 1000,
    isConcentric,
    tolerancePx,
    opticalCorrection,
    details,
  };
}

/**
 * Audits WCAG 2.1 relative luminance contrast between a focus ring and its adjacent background.
 *
 * @param ringColor CSS color string of the focus ring.
 * @param backgroundColor CSS color string of the background.
 * @param targetContrast Target contrast threshold (defaults to 3.0:1 for non-text focus indicators).
 * @returns Contrast ratio and pass/fail verdict.
 */
export function auditFocusRingContrast(
  ringColor: string,
  backgroundColor: string,
  targetContrast = 3.0
): { readonly contrastRatio: number; readonly passes: boolean } {
  const ringParsed = parseCssColor(ringColor);
  const bgParsed = parseCssColor(backgroundColor);
  if (!ringParsed || !bgParsed) {
    return {
      contrastRatio: 1.0,
      passes: false,
    };
  }

  const compositedRing = compositeColorOver(ringParsed, bgParsed);
  const lum1 = calculateWcagLuminance(compositedRing);
  const lum2 = calculateWcagLuminance(bgParsed);

  const maxLum = Math.max(lum1, lum2);
  const minLum = Math.min(lum1, lum2);
  const rawRatio = (maxLum + 0.05) / (minLum + 0.05);
  const contrastRatio = Math.round(rawRatio * 100) / 100;

  return {
    contrastRatio,
    passes: contrastRatio >= targetContrast,
  };
}

/**
 * Computes non-Euclidean optical curvature smoothing metrics for superellipse corners.
 */
export function calculateOpticalCurvatureMetrics(
  innerRadius: number,
  ringOffset: number,
  outerRadius: number,
  curvatureSmoothing?: number,
  curvatureExponent?: number
): OpticalCurvatureMetrics {
  const exponent = curvatureExponent !== undefined
    ? curvatureExponent
    : curvatureSmoothing !== undefined
      ? 2.0 + 3.0 * Math.max(0, Math.min(1, curvatureSmoothing))
      : 2.0;

  const smoothingFactor = curvatureSmoothing !== undefined
    ? Math.max(0, Math.min(1, curvatureSmoothing))
    : Math.max(0, Math.min(1, (exponent - 2.0) / 3.0));

  const circleDiagFactor = 1 / Math.SQRT2;
  const superellipseDiagFactor = exponent > 0 ? 1 / Math.pow(2, 1 / exponent) : circleDiagFactor;
  const diagonalDeltaFactor = superellipseDiagFactor - circleDiagFactor;

  const nonEuclideanDelta = Math.round(innerRadius * diagonalDeltaFactor * 1000) / 1000;
  const cornerArcLengthCorrection = Math.round((1 + (Math.max(0, exponent - 2) / Math.max(1, exponent)) * 0.2146) * 1000) / 1000;
  const hasG2Continuity = exponent >= 2.5 && exponent <= 6.0;

  return {
    innerRadius,
    ringOffset,
    outerRadius,
    curvatureExponent: Math.round(exponent * 100) / 100,
    smoothingFactor: Math.round(smoothingFactor * 1000) / 1000,
    nonEuclideanDelta,
    cornerArcLengthCorrection,
    hasG2Continuity,
  };
}

/**
 * Snaps a CSS pixel measurement to whole physical device pixels.
 */
export function snapToDevicePixelRatio(value: number, dpr: number): number {
  if (dpr <= 0) return value;
  return Math.round(value * dpr) / dpr;
}

/**
 * Validates optical ring snapping, concentricity, subpixel alignment across DPR scales,
 * non-Euclidean curvature smoothing, clipping bounds, and contrast compliance.
 *
 * @param ring Focus ring geometry and physical context.
 * @param options Optical snapping and evaluation options.
 * @returns Complete validation result including verdicts, snapped bounds, DPR evaluations, and defects.
 */
export function validateFocusRingOpticalSnapping(
  ring: FocusRingGeometry,
  options?: OpticalSnappingOptions
): OpticalSnapResult {
  const dpr = typeof options?.dpr === "number" ? options.dpr : typeof ring.dpr === "number" ? ring.dpr : 1.0;
  const supportedDprScales = options?.supportedDprScales !== undefined ? options.supportedDprScales : [1.0, 1.25, 1.5, 2.0, 3.0];
  const tolerancePx = typeof options?.tolerancePx === "number" ? options.tolerancePx : 1.0;
  const subpixelTolerance = typeof options?.subpixelTolerance === "number" ? options.subpixelTolerance : 0.05;
  const targetContrast = typeof options?.targetContrast === "number" ? options.targetContrast : 3.0;
  const checkClipping = typeof options?.checkClipping === "boolean" ? options.checkClipping : true;
  const selector = ring.selector !== undefined ? ring.selector : "focus-ring-target";

  const defects: FocusRingDefect[] = [];

  // 1. Calculate base outer ring bounds in CSS pixels
  const ringX = ring.elementBounds.x - ring.ringOffset - ring.ringWidth;
  const ringY = ring.elementBounds.y - ring.ringOffset - ring.ringWidth;
  const ringWidth = ring.elementBounds.width + 2 * (ring.ringOffset + ring.ringWidth);
  const ringHeight = ring.elementBounds.height + 2 * (ring.ringOffset + ring.ringWidth);

  // 2. Evaluate Concentric Corners
  const actualOuterRadius = ring.ringRadius !== undefined
    ? ring.ringRadius
    : calculateConcentricRadius(ring.elementBorderRadius, ring.ringOffset + ring.ringWidth);

  const concentricEvaluation = validateNestedConcentricCorners(
    actualOuterRadius,
    ring.elementBorderRadius,
    ring.ringOffset + ring.ringWidth,
    tolerancePx
  );

  if (!concentricEvaluation.isConcentric) {
    defects.push({
      id: `focus-ring-concentric-${selector}`,
      type: "concentric-mismatch",
      message: `Focus ring corner radius (${actualOuterRadius}px) is not concentric with element radius (${ring.elementBorderRadius}px) and offset/thickness (${ring.ringOffset + ring.ringWidth}px). Expected ${concentricEvaluation.expectedOuterRadius}px, delta ${concentricEvaluation.delta}px exceeds ${tolerancePx}px tolerance.`,
      severity: "moderate",
      suggestedRemediation: `Set focus ring border radius to ${concentricEvaluation.expectedOuterRadius}px (element border-radius + outline-offset + outline-width).`,
      metrics: {
        innerRadius: ring.elementBorderRadius,
        padding: ring.ringOffset + ring.ringWidth,
        actualOuterRadius,
        expectedOuterRadius: concentricEvaluation.expectedOuterRadius,
        delta: concentricEvaluation.delta,
        tolerancePx,
      },
    });
  }

  // 3. Evaluate Subpixel Snapping across DPR scales
  const dprScaleResults: DprSnapEvaluation[] = [];

  for (let i = 0; i < supportedDprScales.length; i++) {
    const scale = supportedDprScales[i];
    if (scale === undefined) continue;

    const physicalRingX = ringX * scale;
    const physicalRingY = ringY * scale;
    const physicalRingWidth = ringWidth * scale;
    const physicalRingHeight = ringHeight * scale;
    const physicalThickness = ring.ringWidth * scale;
    const physicalOffset = ring.ringOffset * scale;

    const subpixelFractionX = getSubpixelFraction(physicalRingX);
    const subpixelFractionY = getSubpixelFraction(physicalRingY);
    const subpixelFractionThickness = getSubpixelFraction(physicalThickness);
    const subpixelFractionOffset = getSubpixelFraction(physicalOffset);
    const subpixelFractionW = getSubpixelFraction(physicalRingWidth);
    const subpixelFractionH = getSubpixelFraction(physicalRingHeight);

    const isPhysicalIntegerAligned =
      subpixelFractionX <= subpixelTolerance &&
      subpixelFractionY <= subpixelTolerance &&
      subpixelFractionThickness <= subpixelTolerance &&
      subpixelFractionOffset <= subpixelTolerance &&
      subpixelFractionW <= subpixelTolerance &&
      subpixelFractionH <= subpixelTolerance;

    const snappedCssBounds: ElementBoundingBox = {
      x: Math.round(physicalRingX) / scale,
      y: Math.round(physicalRingY) / scale,
      width: Math.round(physicalRingWidth) / scale,
      height: Math.round(physicalRingHeight) / scale,
    };

    dprScaleResults.push({
      dpr: scale,
      physicalRingX: Math.round(physicalRingX * 1000) / 1000,
      physicalRingY: Math.round(physicalRingY * 1000) / 1000,
      physicalRingWidth: Math.round(physicalRingWidth * 1000) / 1000,
      physicalRingHeight: Math.round(physicalRingHeight * 1000) / 1000,
      physicalThickness: Math.round(physicalThickness * 1000) / 1000,
      physicalOffset: Math.round(physicalOffset * 1000) / 1000,
      isPhysicalIntegerAligned,
      subpixelFractionX: Math.round(subpixelFractionX * 1000) / 1000,
      subpixelFractionY: Math.round(subpixelFractionY * 1000) / 1000,
      subpixelFractionThickness: Math.round(subpixelFractionThickness * 1000) / 1000,
      subpixelFractionOffset: Math.round(subpixelFractionOffset * 1000) / 1000,
      snappedCssBounds,
    });
  }

  const matchingDpr = dprScaleResults.find((r) => Math.abs(r.dpr - dpr) < 0.001);
  const activeDprEval = matchingDpr !== undefined ? matchingDpr : dprScaleResults[0];
  const snappedRingBounds: ElementBoundingBox = activeDprEval !== undefined
    ? activeDprEval.snappedCssBounds
    : {
        x: Math.round(ringX * dpr) / dpr,
        y: Math.round(ringY * dpr) / dpr,
        width: Math.round(ringWidth * dpr) / dpr,
        height: Math.round(ringHeight * dpr) / dpr,
      };

  if (activeDprEval && !activeDprEval.isPhysicalIntegerAligned) {
    const fractionalParts: string[] = [];
    if (activeDprEval.subpixelFractionX > subpixelTolerance) fractionalParts.push(`x offset frac=${activeDprEval.subpixelFractionX}`);
    if (activeDprEval.subpixelFractionY > subpixelTolerance) fractionalParts.push(`y offset frac=${activeDprEval.subpixelFractionY}`);
    if (activeDprEval.subpixelFractionThickness > subpixelTolerance) fractionalParts.push(`thickness frac=${activeDprEval.subpixelFractionThickness}`);
    if (activeDprEval.subpixelFractionOffset > subpixelTolerance) fractionalParts.push(`outline-offset frac=${activeDprEval.subpixelFractionOffset}`);

    defects.push({
      id: `focus-ring-subpixel-${selector}`,
      type: "subpixel-misalignment",
      message: `Focus ring exhibits subpixel raster misalignment at ${dpr}x DPR (${fractionalParts.join(", ")}), causing stroke blurring and uneven edge antialiasing.`,
      severity: "minor",
      suggestedRemediation: `Snap focus ring offset and width to physical device pixel increments (use snapped bounds: x=${snappedRingBounds.x}px, y=${snappedRingBounds.y}px, w=${snappedRingBounds.width}px, h=${snappedRingBounds.height}px).`,
      metrics: {
        dpr,
        subpixelFractionX: activeDprEval.subpixelFractionX,
        subpixelFractionY: activeDprEval.subpixelFractionY,
        subpixelFractionThickness: activeDprEval.subpixelFractionThickness,
        subpixelFractionOffset: activeDprEval.subpixelFractionOffset,
        snappedX: snappedRingBounds.x,
      },
    });
  }

  // 4. Evaluate Optical Curvature Smoothing
  const opticalCurvatureMetrics = calculateOpticalCurvatureMetrics(
    ring.elementBorderRadius,
    ring.ringOffset,
    actualOuterRadius,
    ring.opticalCurvatureSmoothing,
    options?.curvatureExponent
  );

  if (opticalCurvatureMetrics.curvatureExponent < 1.0 || opticalCurvatureMetrics.curvatureExponent > 10.0) {
    defects.push({
      id: `focus-ring-distortion-${selector}`,
      type: "optical-distortion",
      message: `Non-Euclidean optical curvature exponent (${opticalCurvatureMetrics.curvatureExponent}) produces geometric distortion (pinched astroid corners or clipped right-angle vertices).`,
      severity: "moderate",
      suggestedRemediation: "Constrain optical curvature exponent between 2.0 (circular) and 5.0 (squircle) to maintain G2 continuity.",
      metrics: {
        curvatureExponent: opticalCurvatureMetrics.curvatureExponent,
        smoothingFactor: opticalCurvatureMetrics.smoothingFactor,
        nonEuclideanDelta: opticalCurvatureMetrics.nonEuclideanDelta,
      },
    });
  }

  // 5. Evaluate Clipping Artifacts
  let isClipped = false;
  let clippingOverlap: { readonly topOverflow: number; readonly rightOverflow: number; readonly bottomOverflow: number; readonly leftOverflow: number } | undefined = undefined;

  if (checkClipping && ring.clippingBounds) {
    const clip = ring.clippingBounds;
    const topOverflow = Math.max(0, clip.y - ringY);
    const leftOverflow = Math.max(0, clip.x - ringX);
    const bottomOverflow = Math.max(0, (ringY + ringHeight) - (clip.y + clip.height));
    const rightOverflow = Math.max(0, (ringX + ringWidth) - (clip.x + clip.width));

    if (topOverflow > 0.1 || leftOverflow > 0.1 || bottomOverflow > 0.1 || rightOverflow > 0.1) {
      isClipped = true;
      clippingOverlap = {
        topOverflow: Math.round(topOverflow * 10) / 10,
        rightOverflow: Math.round(rightOverflow * 10) / 10,
        bottomOverflow: Math.round(bottomOverflow * 10) / 10,
        leftOverflow: Math.round(leftOverflow * 10) / 10,
      };

      defects.push({
        id: `focus-ring-clipping-${selector}`,
        type: "clipping-overflow",
        message: `Focus ring extends beyond container clipping boundary [top: ${clippingOverlap.topOverflow}px, right: ${clippingOverlap.rightOverflow}px, bottom: ${clippingOverlap.bottomOverflow}px, left: ${clippingOverlap.leftOverflow}px], causing outline truncation.`,
        severity: "serious",
        suggestedRemediation: "Ensure container has sufficient padding (>= focus ring offset + thickness) or change container overflow mode.",
        metrics: {
          topOverflow: clippingOverlap.topOverflow,
          rightOverflow: clippingOverlap.rightOverflow,
          bottomOverflow: clippingOverlap.bottomOverflow,
          leftOverflow: clippingOverlap.leftOverflow,
        },
      });
    }
  }

  // 6. Contrast Audit
  const contrastAudit = ring.ringColor && ring.backgroundColor
    ? auditFocusRingContrast(ring.ringColor, ring.backgroundColor, targetContrast)
    : { contrastRatio: 21.0, passes: true };

  if (!contrastAudit.passes) {
    defects.push({
      id: `focus-ring-contrast-${selector}`,
      type: "insufficient-contrast",
      message: `Focus ring contrast ratio (${contrastAudit.contrastRatio}:1) fails minimum ${targetContrast}:1 requirement against background.`,
      severity: "serious",
      suggestedRemediation: `Adjust focus ring color (${ring.ringColor}) or background color (${ring.backgroundColor}) to achieve >= ${targetContrast}:1 contrast ratio.`,
      metrics: {
        contrastRatio: contrastAudit.contrastRatio,
        targetContrast,
        ...(ring.ringColor ? { ringColor: ring.ringColor } : {}),
        ...(ring.backgroundColor ? { backgroundColor: ring.backgroundColor } : {}),
      },
    });
  }

  return {
    passed: defects.length === 0,
    concentricEvaluation,
    snappedRingBounds,
    dprScaleResults,
    contrastAudit,
    isClipped,
    ...(clippingOverlap !== undefined ? { clippingOverlap } : {}),
    opticalCurvatureMetrics,
    defects,
  };
}
