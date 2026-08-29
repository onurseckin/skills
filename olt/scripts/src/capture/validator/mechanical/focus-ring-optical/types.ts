import type { ElementBoundingBox } from "../../types.ts";

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
