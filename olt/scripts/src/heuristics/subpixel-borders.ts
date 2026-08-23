/**
 * @file subpixel-borders.ts
 * Subpixel Border Alignment & Hairline Artifact Detector
 *
 * Implements device pixel ratio (DPR 1x, 1.5x, 2x, 3x) scaling, fractional subpixel coordinate normalization,
 * border physical rasterization analysis, transform translation subpixel smearing,
 * anti-aliasing edge contrast verification, and subpixel drift evaluation.
 */

import type { ElementPhysicsSnapshot } from "../capture/validator/types.ts";

export const CANONICAL_FRACTIONAL_DPR_SCALES: readonly number[] = [
  1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 3.0,
];

export interface SubpixelBorderWidths {
  readonly top?: number | undefined;
  readonly right?: number | undefined;
  readonly bottom?: number | undefined;
  readonly left?: number | undefined;
}

export interface SubpixelElementBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SubpixelElementInput {
  readonly selector: string;
  readonly bounds: SubpixelElementBounds;
  readonly borderWidth?: SubpixelBorderWidths | number | undefined;
  readonly transform?: string | undefined;
  readonly dpr?: number | undefined;
  readonly devicePixelRatio?: number | undefined;
  readonly dprScales?: readonly number[] | undefined;
}

export interface SubpixelBorderDefect {
  readonly id: string;
  readonly category:
    | "subpixel-hairline-blur"
    | "subpixel-asymmetric-borders"
    | "subpixel-transform-smear"
    | "subpixel-coordinate-jitter";
  readonly severity: "critical" | "serious" | "moderate" | "minor";
  readonly elementSelector: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface DprEvaluation {
  readonly dpr: number;
  readonly isAligned: boolean;
  readonly maxRoundingError: number;
  readonly physicalBorderWidths: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly physicalBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly artifacts: readonly string[];
}

export interface SubpixelBorderAnalysisResult {
  readonly isCompliant: boolean;
  readonly evaluatedDprs: readonly number[];
  readonly dprEvaluations: readonly DprEvaluation[];
  readonly worstCaseDpr: number;
  readonly maxRoundingErrorAcrossDprs: number;
  readonly defects: readonly SubpixelBorderDefect[];
  readonly remediations: readonly string[];
}

export interface AntiAliasingEdgeContrastResult {
  readonly dpr: number;
  readonly physicalWidth: number;
  readonly fractionalCoverage: number;
  readonly isCrisp: boolean;
  readonly edgeContrastFactor: number;
  readonly roundingError: number;
  readonly defect?: SubpixelBorderDefect | undefined;
}

export interface SubpixelDriftEvaluation {
  readonly dpr: number;
  readonly physicalWidth: number;
  readonly isCrisp: boolean;
  readonly roundingError: number;
  readonly isAntiAliasedBlur: boolean;
  readonly edgeContrastFactor: number;
  readonly snappedCssWidth: number;
}

export interface SubpixelDriftResult {
  readonly cssWidth: number;
  readonly isCrispOnAllDprs: boolean;
  readonly crispDprs: readonly number[];
  readonly blurredDprs: readonly number[];
  readonly evaluations: readonly SubpixelDriftEvaluation[];
  readonly worstCaseRoundingError: number;
  readonly worstCaseDpr: number;
  readonly recommendedCssWidth: number;
  readonly defects: readonly SubpixelBorderDefect[];
}

export interface EdgeContrastEvaluation {
  readonly cssWidth: number;
  readonly dpr: number;
  readonly physicalWidth: number;
  readonly roundingError: number;
  readonly nominalContrastRatio: number;
  readonly effectiveContrastRatio: number;
  readonly contrastDegradationPct: number;
  readonly isCrisp: boolean;
  readonly passesContrastThreshold: boolean;
}

export interface SubpixelValidationOptions {
  readonly dpr?: number | undefined;
  readonly devicePixelRatio?: number | undefined;
  readonly dprScales?: readonly number[] | undefined;
}

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

/**
 * Analyzes subpixel border alignment, hairline rasterization, and transform artifacts across DPR scales.
 */
export function validateSubpixelBorders(
  input: SubpixelElementInput | readonly SubpixelElementInput[],
  options?: SubpixelValidationOptions,
): SubpixelBorderAnalysisResult {
  const elements = Array.isArray(input) ? input : [input];
  const defects: SubpixelBorderDefect[] = [];
  const remediations: string[] = [];

  const firstInput = elements[0];
  const optionDprs =
    options?.dprScales && options.dprScales.length > 0
      ? options.dprScales
      : options?.devicePixelRatio !== undefined
        ? [options.devicePixelRatio]
        : options?.dpr !== undefined
          ? [options.dpr]
          : undefined;

  const elementDprs =
    firstInput?.dprScales && firstInput.dprScales.length > 0
      ? firstInput.dprScales
      : firstInput?.devicePixelRatio !== undefined
        ? [firstInput.devicePixelRatio]
        : firstInput?.dpr !== undefined
          ? [firstInput.dpr]
          : undefined;

  const dprScales = optionDprs ?? elementDprs ?? CANONICAL_FRACTIONAL_DPR_SCALES;

  const dprEvaluations: DprEvaluation[] = [];
  let worstCaseDpr = dprScales[0] ?? 1.0;
  let maxRoundingErrorAcrossDprs = 0;

  for (const dpr of dprScales) {
    let dprMaxError = 0;
    const dprArtifacts: string[] = [];

    for (const el of elements) {
      const borders = normalizeBorderWidths(el.borderWidth);
      const bounds = el.bounds;
      const trans = parseTransformTranslations(el.transform, bounds);

      const physTop = borders.top * dpr;
      const physRight = borders.right * dpr;
      const physBottom = borders.bottom * dpr;
      const physLeft = borders.left * dpr;

      const topErr = getPhysicalRoundingError(borders.top, dpr);
      const rightErr = getPhysicalRoundingError(borders.right, dpr);
      const bottomErr = getPhysicalRoundingError(borders.bottom, dpr);
      const leftErr = getPhysicalRoundingError(borders.left, dpr);

      const xPhys = (bounds.x + trans.x) * dpr;
      const yPhys = (bounds.y + trans.y) * dpr;
      const wPhys = bounds.width * dpr;
      const hPhys = bounds.height * dpr;

      const xErr = Math.abs(xPhys - Math.round(xPhys));
      const yErr = Math.abs(yPhys - Math.round(yPhys));
      const wErr = Math.abs(wPhys - Math.round(wPhys));
      const hErr = Math.abs(hPhys - Math.round(hPhys));

      const elMaxError = Math.max(topErr, rightErr, bottomErr, leftErr, xErr, yErr, wErr, hErr);
      if (elMaxError > dprMaxError) {
        dprMaxError = elMaxError;
      }

      // Check fractional border rasterization (tolerance threshold: 0.08 physical pixel)
      const hasBorder =
        borders.top > 0 || borders.right > 0 || borders.bottom > 0 || borders.left > 0;
      if (hasBorder && (topErr > 0.08 || rightErr > 0.08 || bottomErr > 0.08 || leftErr > 0.08)) {
        const artifactMsg = `Fractional physical border at ${dpr}x DPR (T=${physTop.toFixed(2)}px, R=${physRight.toFixed(2)}px, B=${physBottom.toFixed(2)}px, L=${physLeft.toFixed(2)}px)`;
        if (!dprArtifacts.includes(artifactMsg)) {
          dprArtifacts.push(artifactMsg);
        }

        const defectId = `subpixel-border-hairline-${el.selector}-${dpr}`;
        if (!defects.some((d) => d.id === defectId)) {
          defects.push({
            id: defectId,
            category: "subpixel-hairline-blur",
            severity: "minor",
            elementSelector: el.selector,
            message: `Element '${el.selector}' exhibits subpixel border rasterization blur at ${dpr}x DPR scale (physical width error: ${Math.max(topErr, rightErr, bottomErr, leftErr).toFixed(3)}px).`,
            metadata: {
              dpr,
              topPhysical: Number(physTop.toFixed(2)),
              rightPhysical: Number(physRight.toFixed(2)),
              bottomPhysical: Number(physBottom.toFixed(2)),
              leftPhysical: Number(physLeft.toFixed(2)),
            },
          });
        }
      }

      // Check asymmetric border rounding (e.g. top rounds to 1px physical, bottom to 2px physical)
      if (borders.top === borders.bottom && borders.top > 0) {
        const roundTop = Math.round(physTop);
        const roundBottom = Math.round(physBottom);
        if (roundTop !== roundBottom) {
          defects.push({
            id: `subpixel-asymmetric-tb-${el.selector}-${dpr}`,
            category: "subpixel-asymmetric-borders",
            severity: "moderate",
            elementSelector: el.selector,
            message: `Opposing vertical borders on '${el.selector}' round to unequal physical pixel thicknesses (${roundTop}px vs ${roundBottom}px) at ${dpr}x DPR.`,
            metadata: { dpr, topPhysicalRounded: roundTop, bottomPhysicalRounded: roundBottom },
          });
        }
      }

      // Check transform translation smearing
      if ((trans.x !== 0 || trans.y !== 0) && (xErr > 0.1 || yErr > 0.1)) {
        const transformDefectId = `subpixel-transform-smear-${el.selector}-${dpr}`;
        if (!defects.some((d) => d.id === transformDefectId)) {
          defects.push({
            id: transformDefectId,
            category: "subpixel-transform-smear",
            severity: "moderate",
            elementSelector: el.selector,
            message: `CSS transform on '${el.selector}' shifts physical raster coordinates off-grid at ${dpr}x DPR (offset x=${(bounds.x + trans.x).toFixed(2)}px, y=${(bounds.y + trans.y).toFixed(2)}px), blurring 1px hairlines.`,
            metadata: {
              dpr,
              translateX: Number(trans.x.toFixed(2)),
              translateY: Number(trans.y.toFixed(2)),
              physicalXRemainder: Number(xErr.toFixed(3)),
              physicalYRemainder: Number(yErr.toFixed(3)),
            },
          });
        }
      }

      // Check coordinate jitter in layout boxes
      if (xErr > 0.15 || yErr > 0.15 || wErr > 0.15 || hErr > 0.15) {
        const jitterDefectId = `subpixel-jitter-${el.selector}-${dpr}`;
        if (!defects.some((d) => d.id === jitterDefectId)) {
          defects.push({
            id: jitterDefectId,
            category: "subpixel-coordinate-jitter",
            severity: "minor",
            elementSelector: el.selector,
            message: `Layout bounding box on '${el.selector}' has fractional physical coordinates at ${dpr}x DPR (w=${wPhys.toFixed(2)}px, h=${hPhys.toFixed(2)}px).`,
            metadata: {
              dpr,
              widthError: Number(wErr.toFixed(3)),
              heightError: Number(hErr.toFixed(3)),
            },
          });
        }
      }
    }

    if (dprMaxError > maxRoundingErrorAcrossDprs) {
      maxRoundingErrorAcrossDprs = dprMaxError;
      worstCaseDpr = dpr;
    }

    const firstEl = elements[0];
    const firstBorders = normalizeBorderWidths(firstEl?.borderWidth);
    const firstBounds = firstEl?.bounds ?? { x: 0, y: 0, width: 0, height: 0 };

    dprEvaluations.push({
      dpr,
      isAligned: dprMaxError <= 0.08,
      maxRoundingError: Number(dprMaxError.toFixed(3)),
      physicalBorderWidths: {
        top: Number((firstBorders.top * dpr).toFixed(2)),
        right: Number((firstBorders.right * dpr).toFixed(2)),
        bottom: Number((firstBorders.bottom * dpr).toFixed(2)),
        left: Number((firstBorders.left * dpr).toFixed(2)),
      },
      physicalBounds: {
        x: Number((firstBounds.x * dpr).toFixed(2)),
        y: Number((firstBounds.y * dpr).toFixed(2)),
        width: Number((firstBounds.width * dpr).toFixed(2)),
        height: Number((firstBounds.height * dpr).toFixed(2)),
      },
      artifacts: dprArtifacts,
    });
  }

  // Generate remediations
  if (defects.some((d) => d.category === "subpixel-transform-smear")) {
    remediations.push(
      "Use `transform: translate3d(round(up, ...), round(up, ...), 0)` or CSS `round()` to snap transformed coordinates to physical pixels.",
    );
  }
  if (defects.some((d) => d.category === "subpixel-hairline-blur")) {
    remediations.push(
      "Use integer CSS pixel border widths (`1px`, `2px`) or `box-shadow: inset 0 0 0 1px ...` to prevent fractional anti-aliasing on fractional DPR displays.",
    );
  }

  return {
    isCompliant: defects.length === 0,
    evaluatedDprs: dprScales,
    dprEvaluations,
    worstCaseDpr,
    maxRoundingErrorAcrossDprs: Number(maxRoundingErrorAcrossDprs.toFixed(3)),
    defects,
    remediations,
  };
}

/**
 * Validates element physics snapshots against subpixel device pixel alignment.
 */
export function validateElementSubpixelPhysics(
  element: ElementPhysicsSnapshot,
  dprOrScales: number | readonly number[] = 1.0,
): SubpixelBorderAnalysisResult {
  const dprScales = typeof dprOrScales === "number" ? [dprOrScales] : dprOrScales;
  const input: SubpixelElementInput = {
    selector: element.selector,
    bounds: {
      x: element.bounds.x,
      y: element.bounds.y,
      width: element.bounds.width,
      height: element.bounds.height,
    },
    transform: element.computedStyles?.transform,
    dprScales,
  };
  return validateSubpixelBorders(input);
}

/**
 * Alias for validateElementSubpixelPhysics.
 */
export const evaluateElementSubpixelPhysics = validateElementSubpixelPhysics;
