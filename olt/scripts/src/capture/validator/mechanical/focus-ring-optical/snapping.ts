export function getSubpixelFraction(val: number): number {
  const frac = Math.abs(val % 1);
  return frac > 0.5 ? 1 - frac : frac;
}

/**
 * Snaps a CSS pixel measurement to whole physical device pixels.
 */
export function snapToDevicePixelRatio(value: number, dpr: number): number {
  if (dpr <= 0) return value;
  return Math.round(value * dpr) / dpr;
}
