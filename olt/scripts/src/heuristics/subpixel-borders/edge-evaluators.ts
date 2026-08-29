/**
 * @file edge-evaluators.ts
 * Edge contrast, anti-aliasing, and subpixel drift evaluation for borders
 */

import type {
  AntiAliasingEdgeContrastResult,
  EdgeContrastEvaluation,
  SubpixelBorderDefect,
  SubpixelDriftEvaluation,
  SubpixelDriftResult,
} from "./types.ts";
import { snapToDevicePixels } from "./utils.ts";

/**
 * Evaluates physical raster edge contrast and subpixel anti-aliasing attenuation for a border edge.
 */
export function evaluateAntiAliasingEdgeContrast(
  borderWidthCss: number,
  dpr: number,
  selector = "border-edge",
): AntiAliasingEdgeContrastResult {
  const physicalWidth = borderWidthCss * dpr;
  const nearestInteger = Math.round(physicalWidth);
  const roundingError = Math.abs(physicalWidth - nearestInteger);
  const isCrisp = roundingError <= 0.08;

  let edgeContrastFactor: number;
  if (physicalWidth <= 0) {
    edgeContrastFactor = 0;
  } else if (physicalWidth < 1) {
    edgeContrastFactor = physicalWidth;
  } else {
    edgeContrastFactor = roundingError === 0 ? 1.0 : Math.max(0.1, 1.0 - roundingError * 0.5);
  }

  let defect: SubpixelBorderDefect | undefined;
  if (!isCrisp && borderWidthCss > 0) {
    defect = {
      id: `subpixel-edge-contrast-${selector}-${dpr}`,
      category: "subpixel-hairline-blur",
      severity: physicalWidth < 1 ? "moderate" : "minor",
      elementSelector: selector,
      message: `Subpixel border width ${borderWidthCss}px yields fractional physical thickness ${physicalWidth.toFixed(2)}px at ${dpr}x DPR (edge contrast factor: ${edgeContrastFactor.toFixed(2)}, rounding error: ${roundingError.toFixed(3)}px).`,
      metadata: {
        dpr,
        borderWidthCss,
        physicalWidth: Number(physicalWidth.toFixed(2)),
        edgeContrastFactor: Number(edgeContrastFactor.toFixed(2)),
        roundingError: Number(roundingError.toFixed(3)),
      },
    };
  }

  return {
    dpr,
    physicalWidth: Number(physicalWidth.toFixed(4)),
    fractionalCoverage:
      physicalWidth < 1
        ? Number(physicalWidth.toFixed(4))
        : Number((physicalWidth % 1 || 1).toFixed(4)),
    isCrisp,
    edgeContrastFactor: Number(edgeContrastFactor.toFixed(4)),
    roundingError: Number(roundingError.toFixed(4)),
    defect,
  };
}

/**
 * Evaluates edge contrast degradation from fractional rasterization.
 */
export function evaluateEdgeContrast(
  cssWidth: number,
  dpr: number,
  nominalContrastRatio = 4.5,
  minThreshold = 3.0,
): EdgeContrastEvaluation {
  const physicalWidth = cssWidth * dpr;
  const nearest = Math.round(physicalWidth);
  const roundingError = Math.abs(physicalWidth - nearest);
  const contrastFactor = Math.max(0.2, 1 - roundingError * 1.2);
  const effectiveContrastRatio = Number((nominalContrastRatio * contrastFactor).toFixed(2));
  const contrastDegradationPct = Number(
    ((1 - effectiveContrastRatio / nominalContrastRatio) * 100).toFixed(1),
  );
  const isCrisp = roundingError <= 0.05;
  const passesContrastThreshold = effectiveContrastRatio >= minThreshold;

  return {
    cssWidth,
    dpr,
    physicalWidth: Number(physicalWidth.toFixed(3)),
    roundingError: Number(roundingError.toFixed(3)),
    nominalContrastRatio,
    effectiveContrastRatio,
    contrastDegradationPct,
    isCrisp,
    passesContrastThreshold,
  };
}

/**
 * Evaluates subpixel drift across DPR scales (1x, 1.5x, 2x, 3x) detecting fractional widths
 * that cause anti-aliasing blur on 1x displays vs crisp rendering on 2x/3x displays.
 */
export function evaluateSubpixelDrift(
  borderWidthCss: number,
  dprScales: readonly number[] = [1.0, 1.5, 2.0, 3.0],
  selector = "border-edge",
): SubpixelDriftResult {
  const crispDprs: number[] = [];
  const blurredDprs: number[] = [];
  const evaluations: SubpixelDriftEvaluation[] = [];
  const defects: SubpixelBorderDefect[] = [];
  let worstCaseRoundingError = 0;
  let worstCaseDpr = dprScales[0] ?? 1.0;

  for (const dpr of dprScales) {
    const physicalWidth = borderWidthCss * dpr;
    const nearestInteger = Math.round(physicalWidth);
    const roundingError = Math.abs(physicalWidth - nearestInteger);
    const isCrisp = roundingError <= 0.05;
    const isAntiAliasedBlur = !isCrisp;

    let edgeContrastFactor: number;
    if (physicalWidth <= 0) {
      edgeContrastFactor = 0;
    } else if (physicalWidth < 1) {
      edgeContrastFactor = physicalWidth;
    } else {
      edgeContrastFactor = roundingError === 0 ? 1.0 : Math.max(0.1, 1.0 - roundingError * 0.5);
    }

    const snappedCssWidth = snapToDevicePixels(borderWidthCss, dpr);

    evaluations.push({
      dpr,
      physicalWidth: Number(physicalWidth.toFixed(4)),
      isCrisp,
      roundingError: Number(roundingError.toFixed(4)),
      isAntiAliasedBlur,
      edgeContrastFactor: Number(edgeContrastFactor.toFixed(4)),
      snappedCssWidth,
    });

    if (isCrisp) {
      crispDprs.push(dpr);
    } else {
      blurredDprs.push(dpr);
    }

    if (roundingError > worstCaseRoundingError) {
      worstCaseRoundingError = roundingError;
      worstCaseDpr = dpr;
    }

    if (isAntiAliasedBlur && borderWidthCss > 0) {
      defects.push({
        id: `subpixel-drift-${selector}-${borderWidthCss}-${dpr}`,
        category: "subpixel-hairline-blur",
        severity: physicalWidth < 1 ? "moderate" : "minor",
        elementSelector: selector,
        message: `Fractional border width ${borderWidthCss}px yields fractional physical thickness ${physicalWidth.toFixed(2)}px at ${dpr}x DPR causing anti-aliasing blur (rounding error: ${roundingError.toFixed(3)}px).`,
        metadata: {
          dpr,
          borderWidthCss,
          physicalWidth: Number(physicalWidth.toFixed(2)),
          edgeContrastFactor: Number(edgeContrastFactor.toFixed(2)),
          roundingError: Number(roundingError.toFixed(3)),
        },
      });
    }
  }

  const isCrispOnAllDprs = blurredDprs.length === 0;
  const recommendedCssWidth =
    borderWidthCss > 0 ? snapToDevicePixels(borderWidthCss, 1.0) || 1.0 : 0;

  return {
    cssWidth: borderWidthCss,
    isCrispOnAllDprs,
    crispDprs,
    blurredDprs,
    evaluations,
    worstCaseRoundingError: Number(worstCaseRoundingError.toFixed(4)),
    worstCaseDpr,
    recommendedCssWidth,
    defects,
  };
}
