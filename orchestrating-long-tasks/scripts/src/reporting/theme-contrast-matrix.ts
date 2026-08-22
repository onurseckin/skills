/**
 * @file theme-contrast-matrix.ts
 * Multi-Theme Contrast Matrix & Dynamic Color Scheme Visual Reporting Engine
 *
 * Implements WCAG 2.1/2.2 AA & AAA and APCA (Accessible Perceptual Contrast Algorithm)
 * contrast evaluations across color schemes (light, dark, high-contrast-light, high-contrast-dark),
 * alpha-blending composite calculations, theme regression tracking, and ASCII visual reporting.
 */

export const THEME_MODES = ["light", "dark", "high-contrast-light", "high-contrast-dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export const CONTRAST_STANDARDS = ["wcag-aa", "wcag-aaa", "apca"] as const;

export type ContrastStandard = (typeof CONTRAST_STANDARDS)[number];

export interface RgbaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface ElementThemePair {
  readonly selector: string;
  readonly theme: ThemeMode;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly element?: string | undefined;
  readonly id?: string | undefined;
  readonly fontSize?: number | undefined;
  readonly fontWeight?: number | string | undefined;
  readonly isLargeText?: boolean | undefined;
  readonly component?: string | undefined;
}

export interface ContrastEvaluation {
  readonly standard: ContrastStandard;
  readonly contrastRatio: number;
  readonly requiredThreshold: number;
  readonly passed: boolean;
  readonly score?: number | undefined;
  readonly note?: string | undefined;
}

export interface ThemeContrastElementResult {
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly effectiveForeground: RgbaColor;
  readonly effectiveBackground: RgbaColor;
  readonly wcagRatio: number;
  readonly apcaLc: number;
  readonly evaluations: readonly ContrastEvaluation[];
  readonly passed: boolean;
}

export interface ThemeContrastMatrix {
  readonly selector: string;
  readonly element?: string | undefined;
  readonly themes: Partial<Record<ThemeMode, ThemeContrastElementResult>>;
  readonly overallPassed: boolean;
  readonly isLargeText: boolean;
}

export type RegressionSeverity = "critical" | "serious" | "moderate" | "minor";

export interface ThemeRegressionFinding {
  readonly id: string;
  readonly selector: string;
  readonly theme: ThemeMode;
  readonly standard: ContrastStandard;
  readonly severity: RegressionSeverity;
  readonly message: string;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly contrastRatio: number;
  readonly requiredThreshold: number;
  readonly details?: string | undefined;
}

export interface MultiThemeComparisonReport {
  readonly timestamp: string;
  readonly totalElements: number;
  readonly evaluatedThemes: readonly ThemeMode[];
  readonly evaluatedStandards: readonly ContrastStandard[];
  readonly matrices: readonly ThemeContrastMatrix[];
  readonly findings: readonly ThemeRegressionFinding[];
  readonly summary: {
    readonly totalChecks: number;
    readonly passedChecks: number;
    readonly failedChecks: number;
    readonly passRate: number;
    readonly themePassRates: Partial<Record<ThemeMode, number>>;
  };
  readonly overallPassed: boolean;
}

/** Standard CSS 148 Named Colors map to [r, g, b]. */
const NAMED_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  aqua: [0, 255, 255],
  aquamarine: [127, 255, 212],
  azure: [240, 255, 255],
  beige: [245, 245, 220],
  bisque: [255, 228, 196],
  black: [0, 0, 0],
  blanchedalmond: [255, 235, 205],
  blue: [0, 0, 255],
  blueviolet: [138, 43, 226],
  brown: [165, 42, 42],
  burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160],
  chartreuse: [127, 255, 0],
  chocolate: [210, 105, 30],
  coral: [255, 127, 80],
  cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220],
  crimson: [220, 20, 60],
  cyan: [0, 255, 255],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkgrey: [169, 169, 169],
  darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkred: [139, 0, 0],
  darksalmon: [233, 150, 122],
  darkseagreen: [143, 188, 143],
  darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79],
  darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34],
  floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255],
  gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255],
  gold: [255, 215, 0],
  goldenrod: [218, 165, 32],
  gray: [128, 128, 128],
  green: [0, 128, 0],
  greenyellow: [173, 255, 47],
  grey: [128, 128, 128],
  honeydew: [240, 255, 240],
  hotpink: [255, 105, 180],
  indianred: [205, 92, 92],
  indigo: [75, 0, 130],
  ivory: [255, 255, 240],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgoldenrodyellow: [250, 250, 210],
  lightgray: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightgrey: [211, 211, 211],
  lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122],
  lightseagreen: [32, 178, 170],
  lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153],
  lightslategrey: [119, 136, 153],
  lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224],
  lime: [0, 255, 0],
  limegreen: [50, 205, 50],
  linen: [250, 240, 230],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  mediumaquamarine: [102, 205, 170],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 112, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181],
  navajowhite: [255, 222, 173],
  navy: [0, 0, 128],
  oldlace: [253, 245, 230],
  olive: [128, 128, 0],
  olivedrab: [107, 142, 35],
  orange: [255, 165, 0],
  orangered: [255, 69, 0],
  orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170],
  palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213],
  peachpuff: [255, 218, 185],
  peru: [205, 133, 63],
  pink: [255, 192, 203],
  plum: [221, 160, 221],
  powderblue: [176, 224, 230],
  purple: [128, 0, 128],
  rebeccapurple: [102, 51, 153],
  red: [255, 0, 0],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  salmon: [250, 128, 114],
  sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  sienna: [160, 82, 45],
  silver: [192, 192, 192],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
  snow: [255, 250, 250],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  thistle: [216, 191, 216],
  tomato: [255, 99, 71],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  wheat: [245, 222, 179],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
  yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50],
  transparent: [0, 0, 0],
};

function clampByte(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clampAlpha(n: number): number {
  if (Number.isNaN(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function parseChannelValue(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed.slice(0, -1));
    return (pct / 100) * 255;
  }
  return parseFloat(trimmed);
}

function parseAlphaValue(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed.slice(0, -1));
    return clampAlpha(pct / 100);
  }
  return clampAlpha(parseFloat(trimmed));
}

function parseHue(hueStr: string): number {
  const trimmed = hueStr.trim().toLowerCase();
  if (trimmed.endsWith("turn")) {
    const turns = parseFloat(trimmed.slice(0, -4));
    return (((turns * 360) % 360) + 360) % 360;
  }
  if (trimmed.endsWith("rad")) {
    const rad = parseFloat(trimmed.slice(0, -3));
    const deg = (rad * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }
  if (trimmed.endsWith("grad")) {
    const grad = parseFloat(trimmed.slice(0, -4));
    const deg = (grad * 360) / 400;
    return ((deg % 360) + 360) % 360;
  }
  if (trimmed.endsWith("deg")) {
    const deg = parseFloat(trimmed.slice(0, -3));
    return ((deg % 360) + 360) % 360;
  }
  const deg = parseFloat(trimmed);
  if (Number.isNaN(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

function parsePercentage(str: string): number {
  const trimmed = str.trim();
  if (trimmed.endsWith("%")) {
    const val = parseFloat(trimmed.slice(0, -1));
    return Math.max(0, Math.min(1, val / 100));
  }
  const val = parseFloat(trimmed);
  if (Number.isNaN(val)) return 0;
  return val <= 1 ? Math.max(0, val) : Math.max(0, Math.min(1, val / 100));
}

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
export function evaluateThemeContrastMatrix(
  elements: readonly ElementThemePair[],
  standards: readonly ContrastStandard[] = CONTRAST_STANDARDS,
): MultiThemeComparisonReport {
  const evaluatedStandards: readonly ContrastStandard[] =
    standards.length === 0 ? CONTRAST_STANDARDS : standards;

  // Group element pairs by selector
  const selectorMap = new Map<string, ElementThemePair[]>();
  const discoveredThemes = new Set<ThemeMode>();

  for (const pair of elements) {
    discoveredThemes.add(pair.theme);
    const existing = selectorMap.get(pair.selector);
    if (existing !== undefined) {
      existing.push(pair);
    } else {
      selectorMap.set(pair.selector, [pair]);
    }
  }

  // If elements specify theme pairs across a subset of themes, evaluate all themes present in the elements batch
  const evaluatedThemes =
    discoveredThemes.size > 0 ? Array.from(discoveredThemes) : [...THEME_MODES];

  const matrices: ThemeContrastMatrix[] = [];
  const findings: ThemeRegressionFinding[] = [];
  let totalChecks = 0;
  let passedChecks = 0;
  let failedChecks = 0;

  const themeCheckStats: Record<ThemeMode, { passed: number; total: number }> = {
    light: { passed: 0, total: 0 },
    dark: { passed: 0, total: 0 },
    "high-contrast-light": { passed: 0, total: 0 },
    "high-contrast-dark": { passed: 0, total: 0 },
  };

  let findingCounter = 0;
  const generateFindingId = (prefix: string): string => {
    findingCounter += 1;
    return `TRF-${prefix}-${findingCounter.toString().padStart(3, "0")}`;
  };

  for (const [selector, pairs] of selectorMap.entries()) {
    const themeResults: Partial<Record<ThemeMode, ThemeContrastElementResult>> = {};
    let elementOverallPassed = true;
    let anyLargeText = false;
    let elementName: string | undefined = undefined;

    // Index by theme mode
    const pairByTheme = new Map<ThemeMode, ElementThemePair>();
    for (const p of pairs) {
      pairByTheme.set(p.theme, p);
      if (p.element !== undefined && elementName === undefined) {
        elementName = p.element;
      }
      if (resolveIsLargeText(p.isLargeText, p.fontSize, p.fontWeight)) {
        anyLargeText = true;
      }
    }

    for (const theme of evaluatedThemes) {
      const pair = pairByTheme.get(theme);

      if (pair === undefined) {
        // Missing theme pair check
        findings.push({
          id: generateFindingId("MISSING"),
          selector,
          theme,
          standard: "wcag-aa",
          severity: "moderate",
          message: `Incomplete theme pair: selector "${selector}" is missing definitions for theme mode "${theme}".`,
          foregroundColor: "none",
          backgroundColor: "none",
          contrastRatio: 0,
          requiredThreshold: getRequiredThreshold("wcag-aa", anyLargeText),
          details: `Missing theme pair leads to unverified accessibility compliance when users switch to ${theme} mode.`,
        });
        elementOverallPassed = false;
        continue;
      }

      const fgValid = isValidColor(pair.foregroundColor);
      const bgValid = isValidColor(pair.backgroundColor);

      if (!fgValid || !bgValid) {
        const invalidDetails =
          !fgValid && !bgValid
            ? `Both foreground "${pair.foregroundColor}" and background "${pair.backgroundColor}" are invalid color expressions.`
            : !fgValid
              ? `Foreground color "${pair.foregroundColor}" is an invalid color expression.`
              : `Background color "${pair.backgroundColor}" is an invalid color expression.`;

        findings.push({
          id: generateFindingId("SYNTAX"),
          selector,
          theme,
          standard: "wcag-aa",
          severity: "critical",
          message: `Invalid color expression in selector "${selector}" (${theme} mode): ${invalidDetails}`,
          foregroundColor: pair.foregroundColor,
          backgroundColor: pair.backgroundColor,
          contrastRatio: 0,
          requiredThreshold: getRequiredThreshold("wcag-aa", anyLargeText),
          details: invalidDetails,
        });
        elementOverallPassed = false;
        continue;
      }

      const isLarge = resolveIsLargeText(pair.isLargeText, pair.fontSize, pair.fontWeight);
      const wcagRatio = calculateWcagContrast(pair.foregroundColor, pair.backgroundColor);
      const apcaLc = calculateApcaContrast(pair.foregroundColor, pair.backgroundColor);

      const fgRgb = parseRgb(pair.foregroundColor);
      const bgRgb = parseRgb(pair.backgroundColor);
      const effectiveBg =
        bgRgb.a < 1 ? compositeRgb(bgRgb, { r: 255, g: 255, b: 255, a: 1 }) : bgRgb;
      const effectiveFg = fgRgb.a < 1 ? compositeRgb(fgRgb, effectiveBg) : fgRgb;

      const evaluations: ContrastEvaluation[] = [];
      let themePassed = true;

      for (const standard of evaluatedStandards) {
        const evalResult = evaluateSingleStandard(standard, wcagRatio, apcaLc, isLarge);
        evaluations.push(evalResult);
        totalChecks += 1;
        themeCheckStats[theme].total += 1;

        if (evalResult.passed) {
          passedChecks += 1;
          themeCheckStats[theme].passed += 1;
        } else {
          failedChecks += 1;
          themePassed = false;
          elementOverallPassed = false;

          let severity: RegressionSeverity = "serious";
          if (theme.startsWith("high-contrast")) {
            severity = "critical";
          } else if (standard === "wcag-aaa") {
            severity = "minor";
          } else if (wcagRatio < 3.0) {
            severity = "critical";
          }

          findings.push({
            id: generateFindingId("FAIL"),
            selector,
            theme,
            standard,
            severity,
            message: `Contrast failure for "${selector}" in "${theme}" mode under ${standard.toUpperCase()}: required ${evalResult.requiredThreshold.toFixed(1)}, found ${evalResult.contrastRatio.toFixed(2)}.`,
            foregroundColor: pair.foregroundColor,
            backgroundColor: pair.backgroundColor,
            contrastRatio: evalResult.contrastRatio,
            requiredThreshold: evalResult.requiredThreshold,
            details: evalResult.note,
          });
        }
      }

      themeResults[theme] = {
        foregroundColor: pair.foregroundColor,
        backgroundColor: pair.backgroundColor,
        effectiveForeground: effectiveFg,
        effectiveBackground: effectiveBg,
        wcagRatio,
        apcaLc,
        evaluations,
        passed: themePassed,
      };
    }

    // Dynamic Theme Regression Detection (e.g. Light passes AA, Dark fails AA)
    const lightRes = themeResults.light;
    const darkRes = themeResults.dark;
    const hcLightRes = themeResults["high-contrast-light"];
    const hcDarkRes = themeResults["high-contrast-dark"];

    if (lightRes !== undefined && darkRes !== undefined) {
      const lightAa = lightRes.evaluations.find((e) => e.standard === "wcag-aa");
      const darkAa = darkRes.evaluations.find((e) => e.standard === "wcag-aa");
      const lightAaPassed = lightAa !== undefined ? lightAa.passed : lightRes.wcagRatio >= 4.5;
      const darkAaPassed = darkAa !== undefined ? darkAa.passed : darkRes.wcagRatio >= 4.5;

      if (lightAaPassed && !darkAaPassed) {
        findings.push({
          id: generateFindingId("REGRESS-DARK"),
          selector,
          theme: "dark",
          standard: "wcag-aa",
          severity: "serious",
          message: `Dark mode contrast regression: selector "${selector}" passes in light mode (CR: ${lightRes.wcagRatio.toFixed(2)}:1), but regresses and fails in dark mode (CR: ${darkRes.wcagRatio.toFixed(2)}:1).`,
          foregroundColor: darkRes.foregroundColor,
          backgroundColor: darkRes.backgroundColor,
          contrastRatio: darkRes.wcagRatio,
          requiredThreshold: getRequiredThreshold("wcag-aa", anyLargeText),
          details:
            "Dark mode color palette fails to preserve adequate contrast compared to light theme baseline.",
        });
      }
    }

    // High Contrast Regression Detection
    if (hcLightRes !== undefined && lightRes !== undefined) {
      if (hcLightRes.wcagRatio < lightRes.wcagRatio) {
        findings.push({
          id: generateFindingId("REGRESS-HC"),
          selector,
          theme: "high-contrast-light",
          standard: "wcag-aa",
          severity: "moderate",
          message: `High-contrast light mode inverted contrast: selector "${selector}" has lower contrast in high-contrast mode (${hcLightRes.wcagRatio.toFixed(2)}:1) than standard light mode (${lightRes.wcagRatio.toFixed(2)}:1).`,
          foregroundColor: hcLightRes.foregroundColor,
          backgroundColor: hcLightRes.backgroundColor,
          contrastRatio: hcLightRes.wcagRatio,
          requiredThreshold: lightRes.wcagRatio,
          details:
            "High-contrast theme mode must yield higher or equal luminance contrast relative to standard themes.",
        });
      }
    }

    if (hcDarkRes !== undefined && darkRes !== undefined) {
      if (hcDarkRes.wcagRatio < darkRes.wcagRatio) {
        findings.push({
          id: generateFindingId("REGRESS-HCDARK"),
          selector,
          theme: "high-contrast-dark",
          standard: "wcag-aa",
          severity: "moderate",
          message: `High-contrast dark mode inverted contrast: selector "${selector}" has lower contrast in high-contrast dark mode (${hcDarkRes.wcagRatio.toFixed(2)}:1) than standard dark mode (${darkRes.wcagRatio.toFixed(2)}:1).`,
          foregroundColor: hcDarkRes.foregroundColor,
          backgroundColor: hcDarkRes.backgroundColor,
          contrastRatio: hcDarkRes.wcagRatio,
          requiredThreshold: darkRes.wcagRatio,
          details:
            "High-contrast theme mode must yield higher or equal luminance contrast relative to standard themes.",
        });
      }
    }

    matrices.push({
      selector,
      ...(elementName !== undefined ? { element: elementName } : {}),
      themes: themeResults,
      overallPassed: elementOverallPassed,
      isLargeText: anyLargeText,
    });
  }

  const themePassRates: Partial<Record<ThemeMode, number>> = {};
  for (const t of evaluatedThemes) {
    const stats = themeCheckStats[t];
    themePassRates[t] =
      stats.total > 0 ? Math.round((stats.passed / stats.total) * 1000) / 10 : 100;
  }

  const passRate = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 1000) / 10 : 100;

  return {
    timestamp: new Date().toISOString(),
    totalElements: selectorMap.size,
    evaluatedThemes,
    evaluatedStandards,
    matrices,
    findings,
    summary: {
      totalChecks,
      passedChecks,
      failedChecks,
      passRate,
      themePassRates,
    },
    overallPassed: failedChecks === 0 && findings.length === 0,
  };
}

/**
 * Renders a clean ASCII / Unicode visual table report for multi-theme contrast compliance.
 */
export function formatThemeContrastMatrixMarkdown(report: MultiThemeComparisonReport): string {
  const lines: string[] = [];

  const statusText = report.overallPassed ? "PASS" : "FAIL";
  const passRateStr = `${report.summary.passRate.toFixed(1)}%`;
  const checksStr = `${report.summary.passedChecks}/${report.summary.totalChecks} checks passed`;

  lines.push("# Multi-Theme Contrast & Dynamic Color Scheme Visual Report");
  lines.push("");
  lines.push("```text");
  lines.push("┌────────────────────────────────────────────────────────────────────────┐");
  lines.push("│ Multi-Theme Contrast Compliance Summary                                │");
  lines.push("├────────────────────────────────────────────────────────────────────────┤");
  lines.push(`│ Overall Status       : ${statusText.padEnd(52)}│`);
  lines.push(`│ Total UI Elements    : ${report.totalElements.toString().padEnd(52)}│`);
  lines.push(`│ Evaluated Themes     : ${report.evaluatedThemes.join(", ").padEnd(52)}│`);
  lines.push(`│ Evaluated Standards  : ${report.evaluatedStandards.join(", ").padEnd(52)}│`);
  lines.push(`│ Total Matrix Checks  : ${report.summary.totalChecks.toString().padEnd(52)}│`);
  lines.push(`│ Overall Pass Rate    : ${(passRateStr + " (" + checksStr + ")").padEnd(52)}│`);
  lines.push(`│ Total Regressions    : ${report.findings.length.toString().padEnd(52)}│`);
  lines.push("└────────────────────────────────────────────────────────────────────────┘");
  lines.push("```");
  lines.push("");

  lines.push("## Theme-Specific Compliance Rates");
  lines.push("");
  for (const theme of report.evaluatedThemes) {
    const rate = report.summary.themePassRates[theme];
    const rateFormatted = rate !== undefined ? `${rate.toFixed(1)}%` : "N/A";
    const indicator = rate !== undefined && rate >= 100 ? "✓" : "✗";
    lines.push(`- **${theme}**: ${rateFormatted} [${indicator}]`);
  }
  lines.push("");

  lines.push("## High-Level Element Contrast Matrix");
  lines.push("");

  // Construct High-Level ASCII Matrix
  const headers = ["Selector", ...report.evaluatedThemes, "Status"];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => ":---").join(" | ")} |`);

  for (const matrix of report.matrices) {
    const row: string[] = [matrix.selector];
    for (const theme of report.evaluatedThemes) {
      const res = matrix.themes[theme];
      if (res === undefined) {
        row.push("MISSING (✗)");
      } else {
        const glyph = res.passed ? "✓" : "✗";
        row.push(`${res.wcagRatio.toFixed(1)}:1 (${glyph})`);
      }
    }
    row.push(matrix.overallPassed ? "PASS" : "FAIL");
    lines.push(`| ${row.join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Detailed Multi-Theme Evaluations");
  lines.push("");
  lines.push(
    "| Selector | Theme | FG Color | BG Color | WCAG CR | APCA Lc | WCAG AA | WCAG AAA | APCA | Status |",
  );
  lines.push("| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |");

  for (const matrix of report.matrices) {
    for (const theme of report.evaluatedThemes) {
      const res = matrix.themes[theme];
      if (res === undefined) {
        lines.push(
          `| \`${matrix.selector}\` | ${theme} | *none* | *none* | N/A | N/A | ✗ FAIL | ✗ FAIL | ✗ FAIL | FAIL |`,
        );
        continue;
      }

      const aaEval = res.evaluations.find((e) => e.standard === "wcag-aa");
      const aaaEval = res.evaluations.find((e) => e.standard === "wcag-aaa");
      const apcaEval = res.evaluations.find((e) => e.standard === "apca");

      const aaCell = aaEval ? (aaEval.passed ? "✓ PASS" : "✗ FAIL") : "-";
      const aaaCell = aaaEval ? (aaaEval.passed ? "✓ PASS" : "✗ FAIL") : "-";
      const apcaCell = apcaEval ? (apcaEval.passed ? "✓ PASS" : "✗ FAIL") : "-";

      const statusCell = res.passed ? "PASS" : "FAIL";

      lines.push(
        `| \`${matrix.selector}\` | ${theme} | \`${res.foregroundColor}\` | \`${res.backgroundColor}\` | ${res.wcagRatio.toFixed(2)}:1 | ${res.apcaLc.toFixed(1)} | ${aaCell} | ${aaaCell} | ${apcaCell} | ${statusCell} |`,
      );
    }
  }
  lines.push("");

  if (report.findings.length > 0) {
    lines.push(`## Contrast Regressions & Findings (${report.findings.length})`);
    lines.push("");
    for (const f of report.findings) {
      const sevTag = f.severity.toUpperCase();
      lines.push(`- **[${sevTag}]** \`${f.selector}\` (\`${f.theme}\` mode): ${f.message}`);
      if (f.details !== undefined && f.details !== "") {
        lines.push(`  - *Details*: ${f.details}`);
      }
      if (f.foregroundColor !== "none") {
        lines.push(
          `  - *Palette*: FG=\`${f.foregroundColor}\`, BG=\`${f.backgroundColor}\` (Measured CR: ${f.contrastRatio.toFixed(2)}:1, Required: ${f.requiredThreshold.toFixed(2)})`,
        );
      }
    }
    lines.push("");
  } else {
    lines.push("## Contrast Regressions & Findings");
    lines.push("");
    lines.push("No contrast regressions or color scheme defects detected across evaluated themes.");
    lines.push("");
  }

  return lines.join("\n");
}
