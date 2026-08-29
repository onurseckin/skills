import {
  calculateWcagLuminance,
  compositeColorOver,
  parseCssColor,
} from "./color.ts";

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
  targetContrast = 3.0,
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
