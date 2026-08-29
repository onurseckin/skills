import type { ElementBoundingBox } from "../../types.ts";
import {
  calculateConcentricRadius,
  validateNestedConcentricCorners,
} from "./concentricity.ts";
import { auditFocusRingContrast } from "./contrast.ts";
import { calculateOpticalCurvatureMetrics } from "./curvature.ts";
import { getSubpixelFraction } from "./snapping.ts";
import type {
  DprSnapEvaluation,
  FocusRingDefect,
  FocusRingGeometry,
  OpticalSnappingOptions,
  OpticalSnapResult,
} from "./types.ts";

/**
 * Validates optical ring snapping, concentricity, subpixel alignment across DPR scales,
 * non-Euclidean curvature smoothing, clipping bounds, and contrast compliance.
 *
 * @param ring Focus ring geometry and physical context.
 * @param options Optical snapping and evaluation options.
 * @returns Complete validation result including verdicts, snapped bounds, DPR evaluations, and defects.
 */
export function validateFocusRingOpticalSnapping(
  ring: FocusRingGeometry,
  options?: OpticalSnappingOptions,
): OpticalSnapResult {
  const dpr =
    typeof options?.dpr === "number" ? options.dpr : typeof ring.dpr === "number" ? ring.dpr : 1.0;
  const supportedDprScales =
    options?.supportedDprScales !== undefined
      ? options.supportedDprScales
      : [1.0, 1.25, 1.5, 2.0, 3.0];
  const tolerancePx = typeof options?.tolerancePx === "number" ? options.tolerancePx : 1.0;
  const subpixelTolerance =
    typeof options?.subpixelTolerance === "number" ? options.subpixelTolerance : 0.05;
  const targetContrast = typeof options?.targetContrast === "number" ? options.targetContrast : 3.0;
  const checkClipping = typeof options?.checkClipping === "boolean" ? options.checkClipping : true;
  const selector = ring.selector !== undefined ? ring.selector : "focus-ring-target";

  const defects: FocusRingDefect[] = [];

  // 1. Calculate base outer ring bounds in CSS pixels
  const ringX = ring.elementBounds.x - ring.ringOffset - ring.ringWidth;
  const ringY = ring.elementBounds.y - ring.ringOffset - ring.ringWidth;
  const ringWidth = ring.elementBounds.width + 2 * (ring.ringOffset + ring.ringWidth);
  const ringHeight = ring.elementBounds.height + 2 * (ring.ringOffset + ring.ringWidth);

  // 2. Evaluate Concentric Corners
  const actualOuterRadius =
    ring.ringRadius !== undefined
      ? ring.ringRadius
      : calculateConcentricRadius(ring.elementBorderRadius, ring.ringOffset + ring.ringWidth);

  const concentricEvaluation = validateNestedConcentricCorners(
    actualOuterRadius,
    ring.elementBorderRadius,
    ring.ringOffset + ring.ringWidth,
    tolerancePx,
  );

  if (!concentricEvaluation.isConcentric) {
    defects.push({
      id: `focus-ring-concentric-${selector}`,
      type: "concentric-mismatch",
      message: `Focus ring corner radius (${actualOuterRadius}px) is not concentric with element radius (${ring.elementBorderRadius}px) and offset/thickness (${ring.ringOffset + ring.ringWidth}px). Expected ${concentricEvaluation.expectedOuterRadius}px, delta ${concentricEvaluation.delta}px exceeds ${tolerancePx}px tolerance.`,
      severity: "moderate",
      suggestedRemediation: `Set focus ring border radius to ${concentricEvaluation.expectedOuterRadius}px (element border-radius + outline-offset + outline-width).`,
      metrics: {
        innerRadius: ring.elementBorderRadius,
        padding: ring.ringOffset + ring.ringWidth,
        actualOuterRadius,
        expectedOuterRadius: concentricEvaluation.expectedOuterRadius,
        delta: concentricEvaluation.delta,
        tolerancePx,
      },
    });
  }

  // 3. Evaluate Subpixel Snapping across DPR scales
  const dprScaleResults: DprSnapEvaluation[] = [];

  for (let i = 0; i < supportedDprScales.length; i++) {
    const scale = supportedDprScales[i];
    if (scale === undefined) continue;

    const physicalRingX = ringX * scale;
    const physicalRingY = ringY * scale;
    const physicalRingWidth = ringWidth * scale;
    const physicalRingHeight = ringHeight * scale;
    const physicalThickness = ring.ringWidth * scale;
    const physicalOffset = ring.ringOffset * scale;

    const subpixelFractionX = getSubpixelFraction(physicalRingX);
    const subpixelFractionY = getSubpixelFraction(physicalRingY);
    const subpixelFractionThickness = getSubpixelFraction(physicalThickness);
    const subpixelFractionOffset = getSubpixelFraction(physicalOffset);
    const subpixelFractionW = getSubpixelFraction(physicalRingWidth);
    const subpixelFractionH = getSubpixelFraction(physicalRingHeight);

    const isPhysicalIntegerAligned =
      subpixelFractionX <= subpixelTolerance &&
      subpixelFractionY <= subpixelTolerance &&
      subpixelFractionThickness <= subpixelTolerance &&
      subpixelFractionOffset <= subpixelTolerance &&
      subpixelFractionW <= subpixelTolerance &&
      subpixelFractionH <= subpixelTolerance;

    const snappedCssBounds: ElementBoundingBox = {
      x: Math.round(physicalRingX) / scale,
      y: Math.round(physicalRingY) / scale,
      width: Math.round(physicalRingWidth) / scale,
      height: Math.round(physicalRingHeight) / scale,
    };

    dprScaleResults.push({
      dpr: scale,
      physicalRingX: Math.round(physicalRingX * 1000) / 1000,
      physicalRingY: Math.round(physicalRingY * 1000) / 1000,
      physicalRingWidth: Math.round(physicalRingWidth * 1000) / 1000,
      physicalRingHeight: Math.round(physicalRingHeight * 1000) / 1000,
      physicalThickness: Math.round(physicalThickness * 1000) / 1000,
      physicalOffset: Math.round(physicalOffset * 1000) / 1000,
      isPhysicalIntegerAligned,
      subpixelFractionX: Math.round(subpixelFractionX * 1000) / 1000,
      subpixelFractionY: Math.round(subpixelFractionY * 1000) / 1000,
      subpixelFractionThickness: Math.round(subpixelFractionThickness * 1000) / 1000,
      subpixelFractionOffset: Math.round(subpixelFractionOffset * 1000) / 1000,
      snappedCssBounds,
    });
  }

  const matchingDpr = dprScaleResults.find((r) => Math.abs(r.dpr - dpr) < 0.001);
  const activeDprEval = matchingDpr !== undefined ? matchingDpr : dprScaleResults[0];
  const snappedRingBounds: ElementBoundingBox =
    activeDprEval !== undefined
      ? activeDprEval.snappedCssBounds
      : {
          x: Math.round(ringX * dpr) / dpr,
          y: Math.round(ringY * dpr) / dpr,
          width: Math.round(ringWidth * dpr) / dpr,
          height: Math.round(ringHeight * dpr) / dpr,
        };

  if (activeDprEval && !activeDprEval.isPhysicalIntegerAligned) {
    const fractionalParts: string[] = [];
    if (activeDprEval.subpixelFractionX > subpixelTolerance)
      fractionalParts.push(`x offset frac=${activeDprEval.subpixelFractionX}`);
    if (activeDprEval.subpixelFractionY > subpixelTolerance)
      fractionalParts.push(`y offset frac=${activeDprEval.subpixelFractionY}`);
    if (activeDprEval.subpixelFractionThickness > subpixelTolerance)
      fractionalParts.push(`thickness frac=${activeDprEval.subpixelFractionThickness}`);
    if (activeDprEval.subpixelFractionOffset > subpixelTolerance)
      fractionalParts.push(`outline-offset frac=${activeDprEval.subpixelFractionOffset}`);

    defects.push({
      id: `focus-ring-subpixel-${selector}`,
      type: "subpixel-misalignment",
      message: `Focus ring exhibits subpixel raster misalignment at ${dpr}x DPR (${fractionalParts.join(", ")}), causing stroke blurring and uneven edge antialiasing.`,
      severity: "minor",
      suggestedRemediation: `Snap focus ring offset and width to physical device pixel increments (use snapped bounds: x=${snappedRingBounds.x}px, y=${snappedRingBounds.y}px, w=${snappedRingBounds.width}px, h=${snappedRingBounds.height}px).`,
      metrics: {
        dpr,
        subpixelFractionX: activeDprEval.subpixelFractionX,
        subpixelFractionY: activeDprEval.subpixelFractionY,
        subpixelFractionThickness: activeDprEval.subpixelFractionThickness,
        subpixelFractionOffset: activeDprEval.subpixelFractionOffset,
        snappedX: snappedRingBounds.x,
      },
    });
  }

  // 4. Evaluate Optical Curvature Smoothing
  const opticalCurvatureMetrics = calculateOpticalCurvatureMetrics(
    ring.elementBorderRadius,
    ring.ringOffset,
    actualOuterRadius,
    ring.opticalCurvatureSmoothing,
    options?.curvatureExponent,
  );

  if (
    opticalCurvatureMetrics.curvatureExponent < 1.0 ||
    opticalCurvatureMetrics.curvatureExponent > 10.0
  ) {
    defects.push({
      id: `focus-ring-distortion-${selector}`,
      type: "optical-distortion",
      message: `Non-Euclidean optical curvature exponent (${opticalCurvatureMetrics.curvatureExponent}) produces geometric distortion (pinched astroid corners or clipped right-angle vertices).`,
      severity: "moderate",
      suggestedRemediation:
        "Constrain optical curvature exponent between 2.0 (circular) and 5.0 (squircle) to maintain G2 continuity.",
      metrics: {
        curvatureExponent: opticalCurvatureMetrics.curvatureExponent,
        smoothingFactor: opticalCurvatureMetrics.smoothingFactor,
        nonEuclideanDelta: opticalCurvatureMetrics.nonEuclideanDelta,
      },
    });
  }

  // 5. Evaluate Clipping Artifacts
  let isClipped = false;
  let clippingOverlap:
    | {
        readonly topOverflow: number;
        readonly rightOverflow: number;
        readonly bottomOverflow: number;
        readonly leftOverflow: number;
      }
    | undefined = undefined;

  if (checkClipping && ring.clippingBounds) {
    const clip = ring.clippingBounds;
    const topOverflow = Math.max(0, clip.y - ringY);
    const leftOverflow = Math.max(0, clip.x - ringX);
    const bottomOverflow = Math.max(0, ringY + ringHeight - (clip.y + clip.height));
    const rightOverflow = Math.max(0, ringX + ringWidth - (clip.x + clip.width));

    if (topOverflow > 0.1 || leftOverflow > 0.1 || bottomOverflow > 0.1 || rightOverflow > 0.1) {
      isClipped = true;
      clippingOverlap = {
        topOverflow: Math.round(topOverflow * 10) / 10,
        rightOverflow: Math.round(rightOverflow * 10) / 10,
        bottomOverflow: Math.round(bottomOverflow * 10) / 10,
        leftOverflow: Math.round(leftOverflow * 10) / 10,
      };

      defects.push({
        id: `focus-ring-clipping-${selector}`,
        type: "clipping-overflow",
        message: `Focus ring extends beyond container clipping boundary [top: ${clippingOverlap.topOverflow}px, right: ${clippingOverlap.rightOverflow}px, bottom: ${clippingOverlap.bottomOverflow}px, left: ${clippingOverlap.leftOverflow}px], causing outline truncation.`,
        severity: "serious",
        suggestedRemediation:
          "Ensure container has sufficient padding (>= focus ring offset + thickness) or change container overflow mode.",
        metrics: {
          topOverflow: clippingOverlap.topOverflow,
          rightOverflow: clippingOverlap.rightOverflow,
          bottomOverflow: clippingOverlap.bottomOverflow,
          leftOverflow: clippingOverlap.leftOverflow,
        },
      });
    }
  }

  // 6. Contrast Audit
  const contrastAudit =
    ring.ringColor && ring.backgroundColor
      ? auditFocusRingContrast(ring.ringColor, ring.backgroundColor, targetContrast)
      : { contrastRatio: 21.0, passes: true };

  if (!contrastAudit.passes) {
    defects.push({
      id: `focus-ring-contrast-${selector}`,
      type: "insufficient-contrast",
      message: `Focus ring contrast ratio (${contrastAudit.contrastRatio}:1) fails minimum ${targetContrast}:1 requirement against background.`,
      severity: "serious",
      suggestedRemediation: `Adjust focus ring color (${ring.ringColor}) or background color (${ring.backgroundColor}) to achieve >= ${targetContrast}:1 contrast ratio.`,
      metrics: {
        contrastRatio: contrastAudit.contrastRatio,
        targetContrast,
        ...(ring.ringColor ? { ringColor: ring.ringColor } : {}),
        ...(ring.backgroundColor ? { backgroundColor: ring.backgroundColor } : {}),
      },
    });
  }

  return {
    passed: defects.length === 0,
    concentricEvaluation,
    snappedRingBounds,
    dprScaleResults,
    contrastAudit,
    isClipped,
    ...(clippingOverlap !== undefined ? { clippingOverlap } : {}),
    opticalCurvatureMetrics,
    defects,
  };
}
