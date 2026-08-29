import type { SubpixelElementBounds, SubpixelBorderWidths } from "./types.ts";

/**
 * Calculate distance from nearest integer physical pixel.
 */
export function getPhysicalRoundingError(val: number, dpr: number): number {
  const physical = val * dpr;
  const nearest = Math.round(physical);
  return Math.abs(physical - nearest);
}

/**
 * Snap CSS pixel values or bounding box coordinates to the nearest physical device pixel boundary.
 */
export function snapToDevicePixels(input: number, dpr: number): number;
export function snapToDevicePixels(
  input: SubpixelElementBounds,
  dpr: number,
): SubpixelElementBounds;
export function snapToDevicePixels(
  input: number | SubpixelElementBounds,
  dpr: number,
): number | SubpixelElementBounds {
  if (dpr <= 0 || !isFinite(dpr)) return input;
  if (typeof input === "number") {
    return Math.round(input * dpr) / dpr;
  }
  return {
    x: Math.round(input.x * dpr) / dpr,
    y: Math.round(input.y * dpr) / dpr,
    width: Math.round(input.width * dpr) / dpr,
    height: Math.round(input.height * dpr) / dpr,
  };
}

/**
 * Parse CSS transform to extract translation component fractions in CSS pixels.
 */
export function parseTransformTranslations(
  transformStr?: string,
  elementBounds?: SubpixelElementBounds,
): { readonly x: number; readonly y: number } {
  if (!transformStr || transformStr === "none") {
    return { x: 0, y: 0 };
  }

  const trimmed = transformStr.trim();
  let tx = 0;
  let ty = 0;

  // matrix(a, b, c, d, tx, ty)
  const matrixMatch = trimmed.match(/matrix\(\s*([^)]+)\s*\)/);
  if (matrixMatch && matrixMatch[1]) {
    const parts = matrixMatch[1].split(",").map((p) => parseFloat(p.trim()));
    const p4 = parts[4];
    const p5 = parts[5];
    if (p4 !== undefined && !isNaN(p4)) tx += p4;
    if (p5 !== undefined && !isNaN(p5)) ty += p5;
  }

  // translate / translate3d
  const translateMatch = trimmed.match(
    /translate(?:3d)?\(\s*([\d.-]+)(px|%)?\s*(?:,\s*([\d.-]+)(px|%)?)?/i,
  );
  if (translateMatch) {
    const rawX = translateMatch[1];
    const unitX = translateMatch[2];
    const rawY = translateMatch[3];
    const unitY = translateMatch[4];

    if (rawX !== undefined) {
      const valX = parseFloat(rawX);
      if (!isNaN(valX)) {
        if (unitX === "%" && elementBounds) {
          tx += (valX / 100) * elementBounds.width;
        } else {
          tx += valX;
        }
      }
    }

    if (rawY !== undefined) {
      const valY = parseFloat(rawY);
      if (!isNaN(valY)) {
        if (unitY === "%" && elementBounds) {
          ty += (valY / 100) * elementBounds.height;
        } else {
          ty += valY;
        }
      }
    }
  }

  return { x: tx, y: ty };
}

/**
 * Normalize border widths input to standard 4-edge object.
 */
export function normalizeBorderWidths(input?: SubpixelBorderWidths | number): {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
} {
  if (typeof input === "number") {
    return { top: input, right: input, bottom: input, left: input };
  }
  if (!input) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  return {
    top: input.top ?? 0,
    right: input.right ?? 0,
    bottom: input.bottom ?? 0,
    left: input.left ?? 0,
  };
}
