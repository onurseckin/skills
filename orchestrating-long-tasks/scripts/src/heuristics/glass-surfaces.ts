/**
 * @file glass-surfaces.ts
 * Extended Glass Surface Heuristic Engine
 *
 * Implements nested glass surface analysis:
 * 1. Backdrop-filter blur parsing and multi-layer Gaussian convolution accumulation.
 * 2. Porter-Duff alpha compositing across stacked translucent surfaces.
 * 3. Luminosity interference & dynamic substrate washout detection.
 * 4. APCA perceived contrast validation across translucent layers against worst-case substrate states.
 */

export interface ParsedRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface GlassSurfaceLayer {
  readonly selector: string;
  readonly backgroundColor?: string;
  readonly backdropFilter?: string;
  readonly webkitBackdropFilter?: string;
  readonly opacity?: number;
  readonly zIndex?: number;
  readonly blurPx?: number;
}

export interface GlassTextElement {
  readonly selector: string;
  readonly text?: string;
  readonly color?: string;
  readonly fontSize?: number;
  readonly fontWeight?: number;
}

export interface GlassSubstrateEvaluation {
  readonly substrateColor: ParsedRgba;
  readonly compositedBg: ParsedRgba;
  readonly apcaLc: number;
  readonly requiredLc: number;
  readonly passed: boolean;
}

export interface GlassSurfaceDefect {
  readonly id: string;
  readonly category:
    | "glass-apca-contrast"
    | "glass-blur-overdraw"
    | "glass-transparency-washout"
    | "glass-missing-blur"
    | "glass-luminosity-clash";
  readonly severity: "critical" | "serious" | "moderate" | "minor";
  readonly elementSelector: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface GlassStackAnalysisResult {
  readonly isCompliant: boolean;
  readonly layerCount: number;
  readonly cumulativeBlurPx: number;
  readonly effectiveLinearBlurPx: number;
  readonly effectiveLayerOpacity: number;
  readonly compositedColorLightSubstrate: ParsedRgba;
  readonly compositedColorDarkSubstrate: ParsedRgba;
  readonly substrates: {
    readonly light: GlassSubstrateEvaluation;
    readonly dark: GlassSubstrateEvaluation;
  };
  readonly worstCaseLc: number;
  readonly requiredLc: number;
  readonly defects: readonly GlassSurfaceDefect[];
  readonly warnings: readonly string[];
}

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
      const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
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
 * Extract blur radius in pixels from backdrop-filter property string.
 */
export function extractBlurRadiusPx(filterStr?: string): number {
  if (!filterStr || filterStr === "none") return 0;
  const match = filterStr.match(/blur\(\s*([\d.]+)\s*(px|rem|em)?\s*\)/i);
  if (!match || match[1] === undefined) return 0;

  const val = parseFloat(match[1]);
  if (isNaN(val)) return 0;

  const unit = match[2] ? match[2].toLowerCase() : "px";
  if (unit === "rem" || unit === "em") {
    return val * 16;
  }
  return val;
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

/**
 * Analyze a stack of nested translucent glass surfaces and validate readability/rendering stability.
 */
export function analyzeGlassSurfaces(
  surfaceStack: readonly GlassSurfaceLayer[],
  textElement?: GlassTextElement,
): GlassStackAnalysisResult {
  const defects: GlassSurfaceDefect[] = [];
  const warnings: string[] = [];

  const layerCount = surfaceStack.length;
  let linearBlurSum = 0;
  let quadraticBlurSum = 0;
  let accumulatedAlpha = 0;

  // Process blur and layer opacity
  for (let i = 0; i < surfaceStack.length; i++) {
    const layer = surfaceStack[i];
    if (!layer) continue;

    const blur = layer.blurPx ?? extractBlurRadiusPx(layer.backdropFilter ?? layer.webkitBackdropFilter);
    linearBlurSum += blur;
    quadraticBlurSum += blur * blur;

    const parsedBg = parseColorToRgba(layer.backgroundColor);
    const layerOpacity = layer.opacity ?? 1;
    const layerAlpha = (parsedBg?.a ?? 1) * layerOpacity;

    accumulatedAlpha = layerAlpha + accumulatedAlpha * (1 - layerAlpha);

    // Flag semi-transparent layers missing backdrop blur if stacking depth is shallow
    if (layerAlpha > 0.05 && layerAlpha < 0.95 && blur === 0) {
      defects.push({
        id: `glass-missing-blur-${i}`,
        category: "glass-missing-blur",
        severity: "minor",
        elementSelector: layer.selector,
        message: `Translucent surface '${layer.selector}' has alpha=${layerAlpha.toFixed(2)} but lacks backdrop-filter blur, leading to background high-frequency noise.`,
        metadata: {
          alpha: Number(layerAlpha.toFixed(2)),
          hasBlur: false,
        },
      });
    }
  }

  // Gaussian convolution effective blur: sqrt(sum(blur_i^2))
  const cumulativeBlurPx = Math.sqrt(quadraticBlurSum);

  // Check blur overdraw & excessive depth
  if (layerCount > 3) {
    const lastLayer = surfaceStack[surfaceStack.length - 1];
    defects.push({
      id: "glass-stack-excessive-depth",
      category: "glass-blur-overdraw",
      severity: "serious",
      elementSelector: lastLayer ? lastLayer.selector : "glass-stack",
      message: `Glass surface stacking depth (${layerCount} layers) exceeds recommended ceiling (3 layers), creating GPU overdraw bottleneck.`,
      metadata: {
        layerCount,
        maxRecommendedDepth: 3,
      },
    });
  }

  if (cumulativeBlurPx > 40) {
    warnings.push(
      `High cumulative backdrop blur (${cumulativeBlurPx.toFixed(1)}px) may cause frame drops on lower-tier mobile GPUs.`,
    );
  }

  // Check transparency washout (effective alpha < 0.15)
  if (layerCount > 0 && accumulatedAlpha < 0.15) {
    const firstLayer = surfaceStack[0];
    defects.push({
      id: "glass-transparency-washout",
      category: "glass-transparency-washout",
      severity: "serious",
      elementSelector: firstLayer ? firstLayer.selector : "glass-stack",
      message: `Cumulative glass surface opacity (${(accumulatedAlpha * 100).toFixed(1)}%) is under 15%, causing severe luminosity washout and loss of visual containment.`,
      metadata: {
        accumulatedAlpha: Number(accumulatedAlpha.toFixed(3)),
      },
    });
  }

  // Substrate compositing (Light substrate: #FFFFFF, Dark substrate: #000000)
  const lightSubstrate: ParsedRgba = { r: 255, g: 255, b: 255, a: 1 };
  const darkSubstrate: ParsedRgba = { r: 0, g: 0, b: 0, a: 1 };

  let compLight = lightSubstrate;
  let compDark = darkSubstrate;

  for (const layer of surfaceStack) {
    const rawColor = parseColorToRgba(layer.backgroundColor) ?? { r: 255, g: 255, b: 255, a: 0.5 };
    const layerOpacity = layer.opacity ?? 1;
    const effectiveFg: ParsedRgba = {
      r: rawColor.r,
      g: rawColor.g,
      b: rawColor.b,
      a: rawColor.a * layerOpacity,
    };
    compLight = compositeRgba(effectiveFg, compLight);
    compDark = compositeRgba(effectiveFg, compDark);
  }

  // 3. APCA Perceived Contrast on Worst-Case Substrate
  const textSelector = textElement?.selector ? textElement.selector : "glass-text";
  const textRgb = parseColorToRgba(textElement?.color ? textElement.color : "#000000") || { r: 0, g: 0, b: 0, a: 1 };
  const fontSize = typeof textElement?.fontSize === "number" ? textElement.fontSize : 16;
  const fontWeight = typeof textElement?.fontWeight === "number" ? textElement.fontWeight : 400;
  const requiredLc = getRequiredApcaLc(fontSize, fontWeight);

  const lightLc = calculateApcaLightnessContrast(textRgb, compLight);
  const darkLc = calculateApcaLightnessContrast(textRgb, compDark);
  const absLightLc = Math.abs(lightLc);
  const absDarkLc = Math.abs(darkLc);
  const worstCaseLc = Math.min(absLightLc, absDarkLc);

  const lightPassed = absLightLc >= requiredLc;
  const darkPassed = absDarkLc >= requiredLc;

  const lightSubEval: GlassSubstrateEvaluation = {
    substrateColor: lightSubstrate,
    compositedBg: compLight,
    apcaLc: Number(lightLc.toFixed(1)),
    requiredLc,
    passed: lightPassed,
  };

  const darkSubEval: GlassSubstrateEvaluation = {
    substrateColor: darkSubstrate,
    compositedBg: compDark,
    apcaLc: Number(darkLc.toFixed(1)),
    requiredLc,
    passed: darkPassed,
  };

  // If text is present, evaluate contrast defects
  if (textElement?.text && textElement.text.trim().length > 0) {
    if (!lightPassed || !darkPassed) {
      const failingSubstrates: string[] = [];
      if (!lightPassed) failingSubstrates.push(`light substrate (Lc=${absLightLc.toFixed(1)})`);
      if (!darkPassed) failingSubstrates.push(`dark substrate (Lc=${absDarkLc.toFixed(1)})`);

      const severity = worstCaseLc < 45 ? "critical" : "serious";
      defects.push({
        id: `glass-apca-${textElement.selector}`,
        category: "glass-apca-contrast",
        severity,
        elementSelector: textElement.selector,
        message: `APCA contrast over dynamic translucent glass substrate failed on ${failingSubstrates.join(" and ")}. Required threshold is Lc=${requiredLc} (fontSize=${fontSize}px, fontWeight=${fontWeight}).`,
        metadata: {
          worstCaseLc: Number(worstCaseLc.toFixed(1)),
          requiredLc,
          fontSize,
          fontWeight,
          lightLc: Number(lightLc.toFixed(1)),
          darkLc: Number(darkLc.toFixed(1)),
        },
      });
    }

    // Luminosity clash detection (when text luminance is extremely close to composited background)
    const yTxt = sRgbToLuminanceY(textRgb);
    const yLightComp = sRgbToLuminanceY(compLight);
    const yDarkComp = sRgbToLuminanceY(compDark);
    if (Math.abs(yTxt - yLightComp) < 0.05 || Math.abs(yTxt - yDarkComp) < 0.05) {
      defects.push({
        id: `glass-luminosity-clash-${textElement.selector}`,
        category: "glass-luminosity-clash",
        severity: "moderate",
        elementSelector: textElement.selector,
        message: `Foreground text luminance (Y=${yTxt.toFixed(3)}) is within the interference dead-zone of translucent substrate luminance, causing edge vibration.`,
        metadata: {
          textLuminance: Number(yTxt.toFixed(3)),
          lightBgLuminance: Number(yLightComp.toFixed(3)),
          darkBgLuminance: Number(yDarkComp.toFixed(3)),
        },
      });
    }
  }

  const isCompliant = defects.length === 0;

  return {
    isCompliant,
    layerCount,
    cumulativeBlurPx: Number(cumulativeBlurPx.toFixed(2)),
    effectiveLinearBlurPx: Number(linearBlurSum.toFixed(2)),
    effectiveLayerOpacity: Number(accumulatedAlpha.toFixed(3)),
    compositedColorLightSubstrate: compLight,
    compositedColorDarkSubstrate: compDark,
    substrates: {
      light: lightSubEval,
      dark: darkSubEval,
    },
    worstCaseLc: Number(worstCaseLc.toFixed(1)),
    requiredLc,
    defects,
    warnings,
  };
}

/**
 * Calculate effective cumulative blur across a sequence of Gaussian blur radii.
 */
export function calculateEffectiveCumulativeBlur(blurs: readonly number[]): {
  readonly linearSumPx: number;
  readonly quadraticCumulativePx: number;
} {
  let linearSumPx = 0;
  let quadraticSum = 0;
  for (const b of blurs) {
    if (typeof b === "number" && !isNaN(b) && b > 0) {
      linearSumPx += b;
      quadraticSum += b * b;
    }
  }
  return {
    linearSumPx: Number(linearSumPx.toFixed(2)),
    quadraticCumulativePx: Number(Math.sqrt(quadraticSum).toFixed(2)),
  };
}

/**
 * Simulate APCA contrast across multiple custom background substrates for a nested glass stack.
 */
export function simulateSubstrateContrasts(
  surfaceStack: readonly GlassSurfaceLayer[],
  textElement: GlassTextElement,
  customSubstrates: readonly ParsedRgba[] = [
    { r: 255, g: 255, b: 255, a: 1 },
    { r: 0, g: 0, b: 0, a: 1 },
    { r: 128, g: 128, b: 128, a: 1 },
  ],
): readonly GlassSubstrateEvaluation[] {
  const evaluations: GlassSubstrateEvaluation[] = [];
  const textRgb = textElement.color ? parseColorToRgba(textElement.color) : null;
  if (!textRgb) {
    return evaluations;
  }
  const fontSize = typeof textElement.fontSize === "number" ? textElement.fontSize : 16;
  const fontWeight = typeof textElement.fontWeight === "number" ? textElement.fontWeight : 400;
  const requiredLc = getRequiredApcaLc(fontSize, fontWeight);

  for (const substrate of customSubstrates) {
    let composited = substrate;
    for (const layer of surfaceStack) {
      const rawColor = layer.backgroundColor ? parseColorToRgba(layer.backgroundColor) : null;
      if (!rawColor) {
        continue;
      }
      const layerOpacity = layer.opacity ?? 1;
      const effectiveFg: ParsedRgba = {
        r: rawColor.r,
        g: rawColor.g,
        b: rawColor.b,
        a: rawColor.a * layerOpacity,
      };
      composited = compositeRgba(effectiveFg, composited);
    }

    const lc = calculateApcaLightnessContrast(textRgb, composited);
    const passed = Math.abs(lc) >= requiredLc;

    evaluations.push({
      substrateColor: substrate,
      compositedBg: composited,
      apcaLc: Number(lc.toFixed(1)),
      requiredLc,
      passed,
    });
  }

  return evaluations;
}
