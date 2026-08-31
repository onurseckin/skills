import { CANONICAL_4_VIEWPORTS, DEFAULT_SUBPIXEL_TOLERANCE_PX } from "./constants.ts";
import type { OverflowInspection, UiViewportTier } from "./types.ts";

export function inspectHorizontalOverflow(
  selector: string,
  viewport: UiViewportTier,
  scrollWidth: number,
  clientWidth: number,
  overflowX?: number,
  deviceScaleFactor?: number,
): OverflowInspection {
  const dpr = deviceScaleFactor ?? CANONICAL_4_VIEWPORTS[viewport]?.deviceScaleFactor ?? 1;
  const subpixelTolerance = Math.max(DEFAULT_SUBPIXEL_TOLERANCE_PX, 1 / dpr + 0.1);
  const delta = overflowX !== undefined ? overflowX : Math.max(0, scrollWidth - clientWidth);
  const hasOverflow = delta > subpixelTolerance;
  const message = hasOverflow
    ? `Horizontal overflow detected in ${selector} on ${viewport} (scrollWidth ${scrollWidth}px > clientWidth ${clientWidth}px, overflow +${delta.toFixed(2)}px exceeding ${subpixelTolerance.toFixed(2)}px DPR tolerance)`
    : `No horizontal overflow in ${selector} on ${viewport}`;

  return {
    selector,
    viewport,
    scrollWidth,
    clientWidth,
    overflowX: delta,
    hasOverflow,
    message,
  };
}

export function inspectAllOverflowElements(
  elements: readonly {
    selector: string;
    viewport?: string | undefined;
    scrollWidth: number;
    clientWidth: number;
    overflowX?: number | undefined;
    deviceScaleFactor?: number | undefined;
  }[],
  defaultViewport: UiViewportTier = "mobile",
): {
  evaluations: readonly OverflowInspection[];
  violations: readonly OverflowInspection[];
} {
  const evaluations: OverflowInspection[] = [];
  const violations: OverflowInspection[] = [];

  for (const el of elements) {
    const vp = (el.viewport as UiViewportTier) || defaultViewport;
    const result = inspectHorizontalOverflow(
      el.selector,
      vp,
      el.scrollWidth,
      el.clientWidth,
      el.overflowX,
      el.deviceScaleFactor,
    );
    evaluations.push(result);
    if (result.hasOverflow) {
      violations.push(result);
    }
  }

  return { evaluations, violations };
}
