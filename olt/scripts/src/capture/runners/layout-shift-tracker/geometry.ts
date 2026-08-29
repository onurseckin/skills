import type { AABB } from "../types.ts";

/**
 * Clips an axis-aligned bounding box to the visible viewport bounds.
 * Returns null if the bounding box has no intersection with the viewport.
 */
export function clipRectToViewport(
  rect: AABB,
  viewportWidth: number,
  viewportHeight: number,
): AABB | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const left = Math.max(0, Math.min(viewportWidth, rect.left ?? rect.x));
  const right = Math.max(0, Math.min(viewportWidth, rect.right ?? rect.x + rect.width));
  const top = Math.max(0, Math.min(viewportHeight, rect.top ?? rect.y));
  const bottom = Math.max(0, Math.min(viewportHeight, rect.bottom ?? rect.y + rect.height));

  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: left,
    y: top,
    width,
    height,
    left,
    right,
    top,
    bottom,
  };
}

/**
 * Computes the exact 2D geometric union area of a collection of bounding boxes
 * using a 1D sweep-line algorithm to avoid double-counting overlapping areas.
 */
export function computeRectanglesUnionArea(rects: readonly AABB[]): number {
  if (rects.length === 0) return 0;
  if (rects.length === 1) {
    const r = rects[0]!;
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  // Collect and sort unique X boundary coordinates
  const xCoordinates: number[] = [];
  for (const r of rects) {
    const left = r.left ?? r.x;
    const right = r.right ?? r.x + r.width;
    if (right > left) {
      xCoordinates.push(left, right);
    }
  }

  if (xCoordinates.length === 0) return 0;
  xCoordinates.sort((a, b) => a - b);

  // Filter unique X coordinates
  const uniqueX: number[] = [];
  for (let i = 0; i < xCoordinates.length; i++) {
    if (i === 0 || Math.abs(xCoordinates[i]! - xCoordinates[i - 1]!) > 1e-6) {
      uniqueX.push(xCoordinates[i]!);
    }
  }

  let totalArea = 0;

  // Sweep across each X slice
  for (let i = 0; i < uniqueX.length - 1; i++) {
    const x1 = uniqueX[i]!;
    const x2 = uniqueX[i + 1]!;
    const dx = x2 - x1;
    if (dx <= 0) continue;

    // Collect vertical intervals of all rectangles covering this X slice
    const yIntervals: { top: number; bottom: number }[] = [];
    for (const r of rects) {
      const left = r.left ?? r.x;
      const right = r.right ?? r.x + r.width;
      if (left <= x1 && right >= x2) {
        const top = r.top ?? r.y;
        const bottom = r.bottom ?? r.y + r.height;
        if (bottom > top) {
          yIntervals.push({ top, bottom });
        }
      }
    }

    if (yIntervals.length === 0) continue;

    // Merge 1D vertical intervals
    yIntervals.sort((a, b) => a.top - b.top);
    let totalDy = 0;
    let currentTop = yIntervals[0]!.top;
    let currentBottom = yIntervals[0]!.bottom;

    for (let j = 1; j < yIntervals.length; j++) {
      const next = yIntervals[j]!;
      if (next.top <= currentBottom) {
        currentBottom = Math.max(currentBottom, next.bottom);
      } else {
        totalDy += currentBottom - currentTop;
        currentTop = next.top;
        currentBottom = next.bottom;
      }
    }
    totalDy += currentBottom - currentTop;

    totalArea += dx * totalDy;
  }

  return totalArea;
}

/**
 * Calculates the impact fraction of a layout shift for a single element or a set of shifted rectangles.
 * Impact Fraction = Impact Area (union of visible areas before and after shift) / Viewport Area.
 */
export function calculateImpactFraction(
  elementRectPairs: readonly { previousRect: AABB; currentRect: AABB }[],
  viewport: { width: number; height: number },
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || elementRectPairs.length === 0) {
    return 0;
  }

  const viewportArea = viewport.width * viewport.height;
  const visibleRects: AABB[] = [];

  for (const pair of elementRectPairs) {
    const prevClipped = clipRectToViewport(pair.previousRect, viewport.width, viewport.height);
    if (prevClipped) {
      visibleRects.push(prevClipped);
    }
    const currClipped = clipRectToViewport(pair.currentRect, viewport.width, viewport.height);
    if (currClipped) {
      visibleRects.push(currClipped);
    }
  }

  if (visibleRects.length === 0) {
    return 0;
  }

  const unionArea = computeRectanglesUnionArea(visibleRects);
  const fraction = unionArea / viewportArea;
  return Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
}

/**
 * Calculates the distance fraction of a layout shift.
 * Distance Fraction = Max Displacement (horizontal or vertical) / Max Viewport Dimension (width or height).
 */
export function calculateDistanceFraction(
  maxDisplacement: number,
  viewport: { width: number; height: number },
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || maxDisplacement <= 0) {
    return 0;
  }

  const maxDimension = Math.max(viewport.width, viewport.height);
  if (maxDimension <= 0) return 0;

  const fraction = maxDisplacement / maxDimension;
  return Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
}

/**
 * Calculates the layout shift score for a shift entry.
 * Layout Shift Score = Impact Fraction * Distance Fraction.
 */
export function calculateLayoutShiftScore(
  impactFraction: number,
  distanceFraction: number,
): number {
  const score = impactFraction * distanceFraction;
  return Math.max(0, Number.isFinite(score) ? score : 0);
}
