/**
 * @file physics-evaluators.ts
 * Subpixel border alignment and element physics validation
 */

import type { ElementPhysicsSnapshot } from "../../capture/validator/types.ts";
import {
  CANONICAL_FRACTIONAL_DPR_SCALES,
  type DprEvaluation,
  type SubpixelBorderAnalysisResult,
  type SubpixelBorderDefect,
  type SubpixelElementInput,
  type SubpixelValidationOptions,
} from "./types.ts";
import {
  getPhysicalRoundingError,
  normalizeBorderWidths,
  parseTransformTranslations,
} from "./utils.ts";

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
