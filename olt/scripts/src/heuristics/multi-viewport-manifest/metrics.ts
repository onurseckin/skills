/**
 * @file metrics.ts
 * Physical viewport metric computations and scaling across DPR tiers
 */

import { CANONICAL_VIEWPORT_SPECS } from "./constants.ts";
import type { CanonicalViewport, PhysicalViewportMetrics } from "./types.ts";

/**
 * Computes physical device pixel metrics for a given viewport and DPR scale.
 */
export function computePhysicalViewportMetrics(
  viewport: string,
  dprOverride?: number,
): PhysicalViewportMetrics {
  const norm = viewport.trim().toLowerCase() as CanonicalViewport;
  const spec = CANONICAL_VIEWPORT_SPECS[norm];
  const cssWidth = spec ? spec.width : 1440;
  const cssHeight = spec ? spec.height : 900;
  const dpr = dprOverride ?? (spec ? spec.defaultDpr : 1);
  const physicalWidth = Math.round(cssWidth * dpr);
  const physicalHeight = Math.round(cssHeight * dpr);

  return {
    viewport,
    cssWidth,
    cssHeight,
    dpr,
    physicalWidth,
    physicalHeight,
    totalPhysicalPixels: physicalWidth * physicalHeight,
    isRetinaOrHiDpi: dpr >= 2,
  };
}
