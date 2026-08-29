import type { ConcentricCornerEvaluation } from "./types.ts";

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
  tolerancePx = 1.0,
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
