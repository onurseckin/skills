import type { RgbColor } from "./types.ts";
export function parseColorToRgb(color: string): RgbColor {
  const c = color.trim().toLowerCase();

  // Named color shortcuts
  if (c === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (c === "black") return { r: 0, g: 0, b: 0, a: 1 };
  if (c === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  // Hex regex
  if (c.startsWith("#")) {
    const hex = c.substring(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0]! + hex[0]!, 16);
      const g = parseInt(hex[1]! + hex[1]!, 16);
      const b = parseInt(hex[2]! + hex[2]!, 16);
      return { r, g, b, a: 1 };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return { r, g, b, a: 1 };
    }
    if (hex.length === 8) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      const a = parseInt(hex.substring(6, 8), 16) / 255;
      return { r, g, b, a };
    }
  }

  // rgb/rgba regex
  const rgbMatch = c.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    return { r, g, b, a };
  }

  // Fallback if unrecognized
  return { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Calculate WCAG 2.1 Relative Luminance (sRGB gamma expansion)
 * Reference: WCAG 2.1 relative luminance definition
 */
export function calculateRelativeLuminance(color: string | RgbColor): number {
  const rgb = typeof color === "string" ? parseColorToRgb(color) : color;

  const sR = rgb.r / 255;
  const sG = rgb.g / 255;
  const sB = rgb.b / 255;

  const rLinear = sR <= 0.04045 ? sR / 12.92 : Math.pow((sR + 0.055) / 1.055, 2.4);
  const gLinear = sG <= 0.04045 ? sG / 12.92 : Math.pow((sG + 0.055) / 1.055, 2.4);
  const bLinear = sB <= 0.04045 ? sB / 12.92 : Math.pow((sB + 0.055) / 1.055, 2.4);

  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Calculate WCAG 2.1 Contrast Ratio: (L1 + 0.05) / (L2 + 0.05)
 */
export function calculateWcagContrastRatio(foreground: string, background: string): number {
  const lum1 = calculateRelativeLuminance(foreground);
  const lum2 = calculateRelativeLuminance(background);

  const brighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  const ratio = (brighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

/**
 * Calculate APCA (Advanced Perceptual Contrast Algorithm) Lightness Contrast (Lc)
 * Reference: W3C Silver / APCA 0.98G algorithm standard
 */
export function calculateApcaContrast(foreground: string, background: string): number {
  const rgbFg = parseColorToRgb(foreground);
  const rgbBg = parseColorToRgb(background);

  // APCA sRGB power expansion
  const yFg =
    0.2126729 * Math.pow(rgbFg.r / 255, 2.4) +
    0.7151522 * Math.pow(rgbFg.g / 255, 2.4) +
    0.072175 * Math.pow(rgbFg.b / 255, 2.4);

  const yBg =
    0.2126729 * Math.pow(rgbBg.r / 255, 2.4) +
    0.7151522 * Math.pow(rgbBg.g / 255, 2.4) +
    0.072175 * Math.pow(rgbBg.b / 255, 2.4);

  // Soft clamp for black thresholds
  const blkThrs = 0.022;
  const blkClmp = 1.414;
  let txtY = yFg;
  let bgY = yBg;

  if (txtY < blkThrs) {
    txtY += Math.pow(blkThrs - txtY, blkClmp);
  }
  if (bgY < blkThrs) {
    bgY += Math.pow(blkThrs - bgY, blkClmp);
  }

  let sApca = 0;
  // Normal Polarity (dark text on light bg)
  if (bgY >= txtY) {
    sApca = (Math.pow(bgY, 0.56) - Math.pow(txtY, 0.62)) * 1.14;
  } else {
    // Reverse Polarity (light text on dark bg)
    sApca = (Math.pow(bgY, 0.65) - Math.pow(txtY, 0.55)) * 1.14;
  }

  // Low contrast clipper
  let lc = 0;
  const loOffset = 0.027;
  if (Math.abs(sApca) < loOffset) {
    lc = 0;
  } else if (sApca > 0) {
    lc = (sApca - loOffset) * 100;
  } else {
    lc = (sApca + loOffset) * 100;
  }

  return Math.round(lc * 100) / 100;
}

/**
 * Standard WCAG Compliance Checks
 */
export function isWcagAaCompliant(
  ratio: number,
  options?: { isLargeText?: boolean; isUiComponent?: boolean },
): boolean {
  if (options?.isLargeText || options?.isUiComponent) {
    return ratio >= 3.0;
  }
  return ratio >= 4.5;
}

export function isWcagAaaCompliant(ratio: number, options?: { isLargeText?: boolean }): boolean {
  if (options?.isLargeText) {
    return ratio >= 4.5;
  }
  return ratio >= 7.0;
}

/**
 * APCA Compliance Checks
 * - body text (small standard): Lc >= 75
 * - large text / headings: Lc >= 60
 * - fluent reading: Lc >= 90
 * - subtle / secondary: Lc >= 45
 */
export function isApcaCompliant(
  lcValue: number,
  textType: "body" | "large" | "subtle" | "fluent" = "body",
): boolean {
  const absLc = Math.abs(lcValue);
  switch (textType) {
    case "fluent":
      return absLc >= 90;
    case "body":
      return absLc >= 75;
    case "large":
      return absLc >= 60;
    case "subtle":
      return absLc >= 45;
    default:
      return absLc >= 60;
  }
}

/**
 * Automated Mathematical Contrast Pre-Filter (Early Rounds 1-3)
 */
export interface ContrastAuditTarget {
  readonly elementId: string;
  readonly role: "bodyText" | "headingText" | "mutedText" | "buttonText" | "icon" | "border";
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly isLargeText?: boolean;
}

export interface ContrastAuditResult {
  readonly elementId: string;
  readonly role: string;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly wcagRatio: number;
  readonly apcaLc: number;
  readonly wcagAaPassed: boolean;
  readonly wcagAaaPassed: boolean;
  readonly apcaPassed: boolean;
}

export interface SurfaceContrastReport {
  readonly permutationId: string;
  readonly auditedElementsCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly allPassed: boolean;
  readonly results: readonly ContrastAuditResult[];
}

