import type { OpticalCurvatureMetrics } from "./types.ts";

/**
 * Computes non-Euclidean optical curvature smoothing metrics for superellipse corners.
 */
export function calculateOpticalCurvatureMetrics(
  innerRadius: number,
  ringOffset: number,
  outerRadius: number,
  curvatureSmoothing?: number,
  curvatureExponent?: number,
): OpticalCurvatureMetrics {
  const exponent =
    curvatureExponent !== undefined
      ? curvatureExponent
      : curvatureSmoothing !== undefined
        ? 2.0 + 3.0 * Math.max(0, Math.min(1, curvatureSmoothing))
        : 2.0;

  const smoothingFactor =
    curvatureSmoothing !== undefined
      ? Math.max(0, Math.min(1, curvatureSmoothing))
      : Math.max(0, Math.min(1, (exponent - 2.0) / 3.0));

  const circleDiagFactor = 1 / Math.SQRT2;
  const superellipseDiagFactor = exponent > 0 ? 1 / Math.pow(2, 1 / exponent) : circleDiagFactor;
  const diagonalDeltaFactor = superellipseDiagFactor - circleDiagFactor;

  const nonEuclideanDelta = Math.round(innerRadius * diagonalDeltaFactor * 1000) / 1000;
  const cornerArcLengthCorrection =
    Math.round((1 + (Math.max(0, exponent - 2) / Math.max(1, exponent)) * 0.2146) * 1000) / 1000;
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
