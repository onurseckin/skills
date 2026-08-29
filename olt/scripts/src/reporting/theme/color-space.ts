import { THEME_MODES, ThemeMode, CONTRAST_STANDARDS, ContrastStandard, RgbaColor, ElementThemePair, ContrastEvaluation, ThemeContrastElementResult, ThemeContrastMatrix, RegressionSeverity, ThemeRegressionFinding, MultiThemeComparisonReport } from "./types.ts";
import { isValidColor, parseRgb, compositeRgb, calculateRelativeLuminance, calculateWcagContrast, calculateApcaContrast } from "./color-space.ts";
import { evaluateThemeContrastMatrix } from "./evaluation.ts";
import { formatThemeContrastMatrixMarkdown } from "./render.ts";


/**
 * Checks whether a color string is parseable and non-empty.
 */
export function isValidColor(color: string): boolean {
  if (typeof color !== "string") return false;
  const trimmed = color.trim().toLowerCase();
  if (trimmed === "") return false;
  if (trimmed in NAMED_COLORS) return true;
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    return (
      (hex.length === 3 || hex.length === 4 || hex.length === 6 || hex.length === 8) &&
      /^[0-9a-f]+$/i.test(hex)
    );
  }
  if (/^[0-9a-f]{3,8}$/i.test(trimmed)) {
    return (
      trimmed.length === 3 || trimmed.length === 4 || trimmed.length === 6 || trimmed.length === 8
    );
  }
  if (/^rgba?\s*\(/i.test(trimmed)) {
    const match = trimmed.match(
      /^rgba?\s*\(\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:\s*(?:,|\/)\s*([^,\s/]+))?\s*\)$/i,
    );
    return match !== null;
  }
  if (/^hsla?\s*\(/i.test(trimmed)) {
    const match = trimmed.match(
      /^hsla?\s*\(\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:\s*(?:,|\/)\s*([^,\s/]+))?\s*\)$/i,
    );
    return match !== null;
  }
  return false;
}

/**
 * Parses any CSS color string (Hex, RGB, RGBA, HSL, HSLA, named colors) into an RGBA object.
 * Returns { r: 0, g: 0, b: 0, a: 0 } for invalid or transparent inputs without throwing.
 */

/**
 * Parses any CSS color string (Hex, RGB, RGBA, HSL, HSLA, named colors) into an RGBA object.
 * Returns { r: 0, g: 0, b: 0, a: 0 } for invalid or transparent inputs without throwing.
 */
export function parseRgb(color: string): { r: number; g: number; b: number; a: number } {
  if (typeof color !== "string") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const trimmed = color.trim().toLowerCase();
  if (trimmed === "" || trimmed === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  // Named Colors
  const named = NAMED_COLORS[trimmed];
  if (named !== undefined) {
    const [nr, ng, nb] = named;
    return { r: nr, g: ng, b: nb, a: 1 };
  }

  // Hex Colors with leading #
  const hexStr = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-f]{3}$/i.test(hexStr)) {
    const rChar = hexStr[0];
    const gChar = hexStr[1];
    const bChar = hexStr[2];
    if (rChar !== undefined && gChar !== undefined && bChar !== undefined) {
      return {
        r: parseInt(rChar + rChar, 16),
        g: parseInt(gChar + gChar, 16),
        b: parseInt(bChar + bChar, 16),
        a: 1,
      };
    }
  }
  if (/^[0-9a-f]{4}$/i.test(hexStr)) {
    const rChar = hexStr[0];
    const gChar = hexStr[1];
    const bChar = hexStr[2];
    const aChar = hexStr[3];
    if (rChar !== undefined && gChar !== undefined && bChar !== undefined && aChar !== undefined) {
      return {
        r: parseInt(rChar + rChar, 16),
        g: parseInt(gChar + gChar, 16),
        b: parseInt(bChar + bChar, 16),
        a: clampAlpha(parseInt(aChar + aChar, 16) / 255),
      };
    }
  }
  if (/^[0-9a-f]{6}$/i.test(hexStr)) {
    return {
      r: parseInt(hexStr.slice(0, 2), 16),
      g: parseInt(hexStr.slice(2, 4), 16),
      b: parseInt(hexStr.slice(4, 6), 16),
      a: 1,
    };
  }
  if (/^[0-9a-f]{8}$/i.test(hexStr)) {
    return {
      r: parseInt(hexStr.slice(0, 2), 16),
      g: parseInt(hexStr.slice(2, 4), 16),
      b: parseInt(hexStr.slice(4, 6), 16),
      a: clampAlpha(parseInt(hexStr.slice(6, 8), 16) / 255),
    };
  }

  // RGB and RGBA expressions
  const rgbMatch = trimmed.match(
    /^rgba?\s*\(\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:\s*(?:,|\/)\s*([^,\s/]+))?\s*\)$/i,
  );
  if (rgbMatch) {
    const rRaw = rgbMatch[1];
    const gRaw = rgbMatch[2];
    const bRaw = rgbMatch[3];
    const aRaw = rgbMatch[4];
    if (rRaw !== undefined && gRaw !== undefined && bRaw !== undefined) {
      const r = clampByte(parseChannelValue(rRaw));
      const g = clampByte(parseChannelValue(gRaw));
      const b = clampByte(parseChannelValue(bRaw));
      const a = parseAlphaValue(aRaw);
      return { r, g, b, a };
    }
  }

  // HSL and HSLA expressions
  const hslMatch = trimmed.match(
    /^hsla?\s*\(\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:,|\s+)\s*([^,\s/]+)(?:\s*(?:,|\/)\s*([^,\s/]+))?\s*\)$/i,
  );
  if (hslMatch) {
    const hRaw = hslMatch[1];
    const sRaw = hslMatch[2];
    const lRaw = hslMatch[3];
    const aRaw = hslMatch[4];
    if (hRaw !== undefined && sRaw !== undefined && lRaw !== undefined) {
      const h = parseHue(hRaw);
      const s = parsePercentage(sRaw);
      const l = parsePercentage(lRaw);
      const a = parseAlphaValue(aRaw);

      const k = (n: number): number => (n + h / 30) % 12;
      const f = (n: number): number =>
        l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));

      return {
        r: clampByte(f(0) * 255),
        g: clampByte(f(8) * 255),
        b: clampByte(f(4) * 255),
        a,
      };
    }
  }

  return { r: 0, g: 0, b: 0, a: 0 };
}

/**
 * Composite foreground RGBA over background RGBA using Porter-Duff source-over blending.
 */

/**
 * Composite foreground RGBA over background RGBA using Porter-Duff source-over blending.
 */
export function compositeRgb(
  foreground: { r: number; g: number; b: number; a: number },
  background: { r: number; g: number; b: number; a: number },
): { r: number; g: number; b: number; a: number } {
  const fgA = Math.max(0, Math.min(1, foreground.a));
  const bgA = Math.max(0, Math.min(1, background.a));
  const outA = fgA + bgA * (1 - fgA);

  if (outA <= 0.0001) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const r = Math.round((foreground.r * fgA + background.r * bgA * (1 - fgA)) / outA);
  const g = Math.round((foreground.g * fgA + background.g * bgA * (1 - fgA)) / outA);
  const b = Math.round((foreground.b * fgA + background.b * bgA * (1 - fgA)) / outA);

  return {
    r: clampByte(r),
    g: clampByte(g),
    b: clampByte(b),
    a: clampAlpha(outA),
  };
}

/**
 * Calculate relative luminance for an sRGB color per WCAG 2.1 specification (0.0 to 1.0).
 */

/**
 * Calculate relative luminance for an sRGB color per WCAG 2.1 specification (0.0 to 1.0).
 */
export function calculateRelativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const transform = (c: number): number => {
    const s = Math.max(0, Math.min(255, c)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const rLin = transform(rgb.r);
  const gLin = transform(rgb.g);
  const bLin = transform(rgb.b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Calculate WCAG contrast ratio between foreground and background colors.
 * Automatically performs alpha compositing over underlying background/substrate.
 * Returns value between 1.00 and 21.00.
 */

/**
 * Calculate WCAG contrast ratio between foreground and background colors.
 * Automatically performs alpha compositing over underlying background/substrate.
 * Returns value between 1.00 and 21.00.
 */
export function calculateWcagContrast(fg: string, bg: string): number {
  const fgParsed = parseRgb(fg);
  const bgParsed = parseRgb(bg);

  // If background is translucent, composite over default white canvas substrate
  const effectiveBg =
    bgParsed.a < 1 ? compositeRgb(bgParsed, { r: 255, g: 255, b: 255, a: 1 }) : bgParsed;

  // Composite foreground over the effective background
  const effectiveFg = fgParsed.a < 1 ? compositeRgb(fgParsed, effectiveBg) : fgParsed;

  const l1 = calculateRelativeLuminance(effectiveFg);
  const l2 = calculateRelativeLuminance(effectiveBg);

  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  const ratio = (brighter + 0.05) / (darker + 0.05);
  const clamped = Math.max(1, Math.min(21, ratio));
  return Math.round(clamped * 100) / 100;
}

/**
 * Calculate APCA (Accessible Perceptual Contrast Algorithm) Lightness Contrast (Lc) value.
 * Text (foreground) over background.
 * Returns signed Lc value (-108.0 to +106.0).
 */

/**
 * Calculate APCA (Accessible Perceptual Contrast Algorithm) Lightness Contrast (Lc) value.
 * Text (foreground) over background.
 * Returns signed Lc value (-108.0 to +106.0).
 */
export function calculateApcaContrast(fg: string, bg: string): number {
  const fgParsed = parseRgb(fg);
  const bgParsed = parseRgb(bg);

  const effectiveBg =
    bgParsed.a < 1 ? compositeRgb(bgParsed, { r: 255, g: 255, b: 255, a: 1 }) : bgParsed;

  const effectiveFg = fgParsed.a < 1 ? compositeRgb(fgParsed, effectiveBg) : fgParsed;

  const toApcaY = (c: { r: number; g: number; b: number }): number => {
    const rLin = Math.pow(Math.max(0, Math.min(255, c.r)) / 255, 2.4);
    const gLin = Math.pow(Math.max(0, Math.min(255, c.g)) / 255, 2.4);
    const bLin = Math.pow(Math.max(0, Math.min(255, c.b)) / 255, 2.4);
    return 0.2126729 * rLin + 0.7151522 * gLin + 0.072175 * bLin;
  };

  let yTxt = toApcaY(effectiveFg);
  let yBg = toApcaY(effectiveBg);

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

  if (Math.abs(contrast) < 0.1) {
    return 0;
  }

  const lc = contrast > 0 ? (contrast - 0.027) * 100 : (contrast + 0.027) * 100;
  return Math.round(lc * 100) / 100;
}


function resolveIsLargeText(
  isLarge?: boolean | undefined,
  fontSize?: number | undefined,
  fontWeight?: number | string | undefined,
): boolean {
  if (typeof isLarge === "boolean") return isLarge;
  const size = typeof fontSize === "number" ? fontSize : 16;
  const isBold =
    typeof fontWeight === "number"
      ? fontWeight >= 600
      : typeof fontWeight === "string"
        ? fontWeight === "bold" ||
          fontWeight === "bolder" ||
          fontWeight === "semibold" ||
          fontWeight === "semi-bold" ||
          parseInt(fontWeight, 10) >= 600
        : false;

  if (size >= 24) return true;
  if (size >= 18.66 && isBold) return true;
  if (size >= 16 && isBold) return true;
  return false;
}


function getRequiredThreshold(standard: ContrastStandard, isLargeText: boolean): number {
  switch (standard) {
    case "wcag-aa":
      return isLargeText ? 3.0 : 4.5;
    case "wcag-aaa":
      return isLargeText ? 4.5 : 7.0;
    case "apca":
      return isLargeText ? 60.0 : 75.0;
  }
}


function evaluateSingleStandard(
  standard: ContrastStandard,
  wcagRatio: number,
  apcaLc: number,
  isLargeText: boolean,
): ContrastEvaluation {
  const requiredThreshold = getRequiredThreshold(standard, isLargeText);
  let passed = false;
  let note: string;

  if (standard === "wcag-aa" || standard === "wcag-aaa") {
    passed = wcagRatio >= requiredThreshold;
    note = `Required CR ≥ ${requiredThreshold.toFixed(1)}:1 (${isLargeText ? "Large" : "Normal"} text), Measured: ${wcagRatio.toFixed(2)}:1`;
  } else {
    passed = Math.abs(apcaLc) >= requiredThreshold;
    note = `Required |Lc| ≥ ${requiredThreshold.toFixed(1)} (${isLargeText ? "Large" : "Normal"} text), Measured: ${Math.abs(apcaLc).toFixed(1)}`;
  }

  return {
    standard,
    contrastRatio: standard === "apca" ? Math.abs(apcaLc) : wcagRatio,
    requiredThreshold,
    passed,
    score: standard === "apca" ? Math.abs(apcaLc) : wcagRatio,
    note,
  };
}

/**
 * Evaluate multi-theme contrast matrix across all provided elements and theme pairs.
 */
