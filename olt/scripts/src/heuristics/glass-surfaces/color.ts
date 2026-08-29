/**
 * @file color.ts
 * Color parsing, alpha compositing, and APCA lightness contrast math
 */

import type { ParsedRgba } from "./types.ts";

/**
 * Parse color string to RGBA representation with strict validation.
 */
export function parseColorToRgba(colorStr?: string): ParsedRgba | null {
  if (!colorStr) return null;
  const trimmed = colorStr.trim().toLowerCase();

  if (trimmed === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (trimmed === "white") {
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  if (trimmed === "black") {
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  // Hex colors
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const h0 = hex[0];
      const h1 = hex[1];
      const h2 = hex[2];
      if (h0 !== undefined && h1 !== undefined && h2 !== undefined) {
        const r = parseInt(h0 + h0, 16);
        const g = parseInt(h1 + h1, 16);
        const b = parseInt(h2 + h2, 16);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          return { r, g, b, a: 1 };
        }
      }
    } else if (hex.length === 4) {
      const h0 = hex[0];
      const h1 = hex[1];
      const h2 = hex[2];
      const h3 = hex[3];
      if (h0 !== undefined && h1 !== undefined && h2 !== undefined && h3 !== undefined) {
        const r = parseInt(h0 + h0, 16);
        const g = parseInt(h1 + h1, 16);
        const b = parseInt(h2 + h2, 16);
        const a = parseInt(h3 + h3, 16) / 255;
        if (!isNaN(r) && !isNaN(g) && !isNaN(b) && !isNaN(a)) {
          return { r, g, b, a };
        }
      }
    } else if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return { r, g, b, a: 1 };
      }
    } else if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      if (!isNaN(r) && !isNaN(g) && !isNaN(b) && !isNaN(a)) {
        return { r, g, b, a };
      }
    }
  }

  // RGB and RGBA expressions
  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*([\d.]+%?)\s*(?:,|\s)\s*([\d.]+%?)\s*(?:,|\s)\s*([\d.]+%?)(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/,
  );
  if (rgbaMatch) {
    const m1 = rgbaMatch[1];
    const m2 = rgbaMatch[2];
    const m3 = rgbaMatch[3];
    const m4 = rgbaMatch[4];
    if (m1 !== undefined && m2 !== undefined && m3 !== undefined) {
      const parseChannel = (val: string): number => {
        if (val.endsWith("%")) {
          return Math.min(255, Math.max(0, (parseFloat(val) / 100) * 255));
        }
        return Math.min(255, Math.max(0, parseFloat(val)));
      };
      const r = parseChannel(m1);
      const g = parseChannel(m2);
      const b = parseChannel(m3);
      let a = 1;
      if (m4 !== undefined) {
        if (m4.endsWith("%")) {
          a = Math.min(1, Math.max(0, parseFloat(m4) / 100));
        } else {
          a = Math.min(1, Math.max(0, parseFloat(m4)));
        }
      }
      if (!isNaN(r) && !isNaN(g) && !isNaN(b) && !isNaN(a)) {
        return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
      }
    }
  }

  // HSL / HSLA expressions (simple converter)
  const hslaMatch = trimmed.match(
    /^hsla?\(\s*([\d.]+)(?:deg|grad|rad|turn)?\s*(?:,|\s)\s*([\d.]+)%\s*(?:,|\s)\s*([\d.]+)%(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/,
  );
  if (hslaMatch) {
    const hStr = hslaMatch[1];
    const sStr = hslaMatch[2];
    const lStr = hslaMatch[3];
    const aStr = hslaMatch[4];
    if (hStr !== undefined && sStr !== undefined && lStr !== undefined) {
      const h = ((parseFloat(hStr) % 360) + 360) % 360;
      const s = Math.min(100, Math.max(0, parseFloat(sStr))) / 100;
      const l = Math.min(100, Math.max(0, parseFloat(lStr))) / 100;
      let a = 1;
      if (aStr !== undefined) {
        if (aStr.endsWith("%")) {
          a = Math.min(1, Math.max(0, parseFloat(aStr) / 100));
        } else {
          a = Math.min(1, Math.max(0, parseFloat(aStr)));
        }
      }

      const k = (n: number) => (n + h / 30) % 12;
      const f = (n: number) =>
        l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return {
        r: Math.round(f(0) * 255),
        g: Math.round(f(8) * 255),
        b: Math.round(f(4) * 255),
        a,
      };
    }
  }

  return null;
}

/**
 * Composite foreground RGBA over background RGBA using Porter-Duff Over operation.
 */
export function compositeRgba(fg: ParsedRgba, bg: ParsedRgba): ParsedRgba {
  const fgAlpha = fg.a;
  const bgAlpha = bg.a;
  const outAlpha = fgAlpha + bgAlpha * (1 - fgAlpha);

  if (outAlpha <= 0.0001) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const outR = Math.round((fg.r * fgAlpha + bg.r * bgAlpha * (1 - fgAlpha)) / outAlpha);
  const outG = Math.round((fg.g * fgAlpha + bg.g * bgAlpha * (1 - fgAlpha)) / outAlpha);
  const outB = Math.round((fg.b * fgAlpha + bg.b * bgAlpha * (1 - fgAlpha)) / outAlpha);

  return {
    r: Math.min(255, Math.max(0, outR)),
    g: Math.min(255, Math.max(0, outG)),
    b: Math.min(255, Math.max(0, outB)),
    a: Math.min(1, Math.max(0, outAlpha)),
  };
}

/**
 * Convert sRGB to relative luminance Y (CIE Y 1931 / standard linearized APCA).
 */
export function sRgbToLuminanceY(color: ParsedRgba): number {
  const rLin = Math.pow(color.r / 255, 2.4);
  const gLin = Math.pow(color.g / 255, 2.4);
  const bLin = Math.pow(color.b / 255, 2.4);
  return 0.2126729 * rLin + 0.7151522 * gLin + 0.072175 * bLin;
}

/**
 * Calculate APCA Lightness Contrast (Lc) value between text color and background color.
 */
export function calculateApcaLightnessContrast(textColor: ParsedRgba, bgColor: ParsedRgba): number {
  let yTxt = sRgbToLuminanceY(textColor);
  let yBg = sRgbToLuminanceY(bgColor);

  const blackThresh = 0.022;
  const expBlack = 1.414;

  if (yTxt < blackThresh) {
    yTxt += Math.pow(blackThresh - yTxt, expBlack);
  }
  if (yBg < blackThresh) {
    yBg += Math.pow(blackThresh - yBg, expBlack);
  }

  const scaleFactor = 1.14;
  let contrast = 0;

  if (yBg > yTxt) {
    const yBgExp = Math.pow(yBg, 0.56);
    const yTxtExp = Math.pow(yTxt, 0.57);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  } else {
    const yBgExp = Math.pow(yBg, 0.65);
    const yTxtExp = Math.pow(yTxt, 0.62);
    contrast = (yBgExp - yTxtExp) * scaleFactor;
  }

  if (Math.abs(contrast) < 0.1) return 0;
  return contrast > 0 ? (contrast - 0.027) * 100 : (contrast + 0.027) * 100;
}

/**
 * Determine required APCA Lc based on font size and font weight.
 */
export function getRequiredApcaLc(fontSize: number = 16, fontWeight: number = 400): number {
  const isBold = fontWeight >= 700;
  if (fontSize >= 24 || (fontSize >= 18 && isBold)) {
    return 60;
  }
  if (fontSize >= 16) {
    return 75;
  }
  return 90;
}
