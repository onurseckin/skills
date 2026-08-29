/**
 * @file blur-accumulator.ts
 * Backdrop filter blur parsing and Gaussian blur accumulation
 */

/**
 * Extract blur radius in pixels from backdrop-filter property string.
 */
export function extractBlurRadiusPx(filterStr?: string): number {
  if (!filterStr || filterStr === "none") return 0;
  const match = filterStr.match(/blur\(\s*([\d.]+)\s*(px|rem|em)?\s*\)/i);
  if (!match || match[1] === undefined) return 0;

  const val = parseFloat(match[1]);
  if (isNaN(val)) return 0;

  const unit = match[2] ? match[2].toLowerCase() : "px";
  if (unit === "rem" || unit === "em") {
    return val * 16;
  }
  return val;
}

/**
 * Calculate effective cumulative blur across a sequence of Gaussian blur radii.
 */
export function calculateEffectiveCumulativeBlur(blurs: readonly number[]): {
  readonly linearSumPx: number;
  readonly quadraticCumulativePx: number;
} {
  let linearSumPx = 0;
  let quadraticSum = 0;
  for (const b of blurs) {
    if (typeof b === "number" && !isNaN(b) && b > 0) {
      linearSumPx += b;
      quadraticSum += b * b;
    }
  }
  return {
    linearSumPx: Number(linearSumPx.toFixed(2)),
    quadraticCumulativePx: Number(Math.sqrt(quadraticSum).toFixed(2)),
  };
}
