import type { RgbaColor } from "./types.ts";

export const NAMED_COLORS: Readonly<Record<string, RgbaColor>> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  currentcolor: { r: 0, g: 0, b: 0, a: 1 },
  red: { r: 239, g: 68, b: 68, a: 1 },
  blue: { r: 37, g: 99, b: 235, a: 1 },
  green: { r: 34, g: 197, b: 94, a: 1 },
  yellow: { r: 234, g: 179, b: 8, a: 1 },
  cyan: { r: 6, g: 182, b: 212, a: 1 },
  magenta: { r: 217, g: 70, b: 239, a: 1 },
  gray: { r: 107, g: 114, b: 128, a: 1 },
  grey: { r: 107, g: 114, b: 128, a: 1 },
  silver: { r: 203, g: 213, b: 225, a: 1 },
  navy: { r: 30, g: 58, b: 138, a: 1 },
  teal: { r: 13, g: 148, b: 136, a: 1 },
  purple: { r: 147, g: 51, b: 234, a: 1 },
  orange: { r: 249, g: 115, b: 22, a: 1 },
  indigo: { r: 99, g: 102, b: 241, a: 1 },
  violet: { r: 139, g: 92, b: 246, a: 1 },
  pink: { r: 236, g: 72, b: 153, a: 1 },
  lime: { r: 132, g: 204, b: 22, a: 1 },
  emerald: { r: 16, g: 185, b: 129, a: 1 },
  amber: { r: 245, g: 158, b: 11, a: 1 },
  rose: { r: 244, g: 63, b: 94, a: 1 },
  slate: { r: 100, g: 116, b: 139, a: 1 },
  zinc: { r: 113, g: 113, b: 122, a: 1 },
  neutral: { r: 115, g: 115, b: 115, a: 1 },
  stone: { r: 120, g: 113, b: 108, a: 1 },
};

export function hslToRgb(
  h: number,
  s: number,
  l: number,
): { readonly r: number; readonly g: number; readonly b: number } {
  const normH = ((h % 360) + 360) % 360;
  const normS = Math.max(0, Math.min(1, s / 100));
  const normL = Math.max(0, Math.min(1, l / 100));

  const c = (1 - Math.abs(2 * normL - 1)) * normS;
  const x = c * (1 - Math.abs(((normH / 60) % 2) - 1));
  const m = normL - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (normH >= 0 && normH < 60) {
    rPrime = c;
    gPrime = x;
    bPrime = 0;
  } else if (normH >= 60 && normH < 120) {
    rPrime = x;
    gPrime = c;
    bPrime = 0;
  } else if (normH >= 120 && normH < 180) {
    rPrime = 0;
    gPrime = c;
    bPrime = x;
  } else if (normH >= 180 && normH < 240) {
    rPrime = 0;
    gPrime = x;
    bPrime = c;
  } else if (normH >= 240 && normH < 300) {
    rPrime = x;
    gPrime = 0;
    bPrime = c;
  } else {
    rPrime = c;
    gPrime = 0;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

/**
 * Parse any standard CSS color string into RGBA components.
 */
export function parseCssColor(colorStr?: string): RgbaColor | null {
  if (!colorStr) return null;
  const trimmed = colorStr.trim().toLowerCase();

  const named = NAMED_COLORS[trimmed];
  if (named) return named;

  // Hex color (#rgb, #rgba, #rrggbb, #rrggbbaa)
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: 1,
      };
    }
    if (hex.length === 4) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: parseInt(hex[3]! + hex[3]!, 16) / 255,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }

  // RGB / RGBA
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*(?:,|\s+)\s*([\d.]+)\s*(?:,|\s+)\s*([\d.]+)(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/i,
  );
  if (rgbMatch) {
    const m1 = rgbMatch[1]!;
    const m2 = rgbMatch[2]!;
    const m3 = rgbMatch[3]!;
    const m4 = rgbMatch[4];
    const r = Math.min(255, Math.max(0, parseFloat(m1)));
    const g = Math.min(255, Math.max(0, parseFloat(m2)));
    const b = Math.min(255, Math.max(0, parseFloat(m3)));
    let a = 1;
    if (m4 !== undefined) {
      a = m4.endsWith("%") ? parseFloat(m4) / 100 : parseFloat(m4);
      a = Math.min(1, Math.max(0, a));
    }
    return { r, g, b, a };
  }

  // HSL / HSLA
  const hslMatch = trimmed.match(
    /^hsla?\(\s*([\d.]+)(?:deg)?\s*(?:,|\s+)\s*([\d.]+)%\s*(?:,|\s+)\s*([\d.]+)%(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/i,
  );
  if (hslMatch) {
    const m1 = hslMatch[1];
    const m2 = hslMatch[2];
    const m3 = hslMatch[3];
    const m4 = hslMatch[4];
    if (m1 !== undefined && m2 !== undefined && m3 !== undefined) {
      const h = parseFloat(m1);
      const s = parseFloat(m2);
      const l = parseFloat(m3);
      const rgb = hslToRgb(h, s, l);
      let a = 1;
      if (m4 !== undefined) {
        a = m4.endsWith("%") ? parseFloat(m4) / 100 : parseFloat(m4);
        a = Math.min(1, Math.max(0, a));
      }
      return { r: rgb.r, g: rgb.g, b: rgb.b, a };
    }
  }

  return null;
}

export function compositeColorOver(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = Math.max(0, Math.min(1, foreground.a));
  if (alpha >= 1) return foreground;

  const r = Math.round(foreground.r * alpha + background.r * (1 - alpha));
  const g = Math.round(foreground.g * alpha + background.g * (1 - alpha));
  const b = Math.round(foreground.b * alpha + background.b * (1 - alpha));
  const a = alpha + background.a * (1 - alpha);

  return { r, g, b, a };
}

export function srgbChannelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function calculateWcagLuminance(color: RgbaColor): number {
  const rLin = srgbChannelToLinear(color.r);
  const gLin = srgbChannelToLinear(color.g);
  const bLin = srgbChannelToLinear(color.b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}
