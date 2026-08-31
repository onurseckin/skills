import type { OverflowInspection, UiViewportTier } from "./types.ts";

export function inspectHorizontalOverflow(
  selector: string,
  viewport: UiViewportTier,
  scrollWidth: number,
  clientWidth: number,
  overflowX?: number,
): OverflowInspection {
  const delta = overflowX !== undefined ? overflowX : Math.max(0, scrollWidth - clientWidth);
  const hasOverflow = delta > 0.5;
  const message = hasOverflow
    ? `Horizontal overflow detected in ${selector} on ${viewport} (scrollWidth ${scrollWidth}px > clientWidth ${clientWidth}px, overflow +${delta}px)`
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
    );
    evaluations.push(result);
    if (result.hasOverflow) {
      violations.push(result);
    }
  }

  return { evaluations, violations };
}
