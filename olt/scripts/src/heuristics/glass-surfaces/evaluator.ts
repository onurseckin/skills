/**
 * @file evaluator.ts
 * Glass surface stack analysis and multi-substrate contrast simulation
 */

import { extractBlurRadiusPx } from "./blur-accumulator.ts";
import {
  calculateApcaLightnessContrast,
  compositeRgba,
  getRequiredApcaLc,
  parseColorToRgba,
  sRgbToLuminanceY,
} from "./color.ts";
import type {
  GlassStackAnalysisResult,
  GlassSubstrateEvaluation,
  GlassSurfaceDefect,
  GlassSurfaceLayer,
  GlassTextElement,
  ParsedRgba,
} from "./types.ts";

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

    const blur =
      layer.blurPx ?? extractBlurRadiusPx(layer.backdropFilter ?? layer.webkitBackdropFilter);
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
  const textRgb = parseColorToRgba(textElement?.color ? textElement.color : "#000000") || {
    r: 0,
    g: 0,
    b: 0,
    a: 1,
  };
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
