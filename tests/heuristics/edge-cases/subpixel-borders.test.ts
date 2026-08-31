/**
 * @file subpixel-borders.test.ts
 * Modular unit tests for Subpixel Borders & Hairline Artifacts Heuristics
 */

import { describe, expect, it } from "bun:test";
import {
  evaluateAntiAliasingEdgeContrast,
  getPhysicalRoundingError,
  normalizeBorderWidths,
  parseTransformTranslations,
  snapToDevicePixels,
  validateSubpixelBorders,
  type SubpixelElementBounds,
  type SubpixelElementInput,
} from "../../../../olt/scripts/src/heuristics/subpixel-borders/index.ts";

describe("Extended Heuristics: Subpixel Borders & Hairline Artifacts", () => {
  it("verifies integer aligned borders across fractional DPR scales", () => {
    const result = validateSubpixelBorders({
      selector: ".aligned-box",
      bounds: { x: 100, y: 100, width: 200, height: 100 },
      borderWidth: 2,
      dprScales: [1.0, 1.5, 2.0, 2.5, 3.0],
    });

    expect(result.isCompliant).toBe(true);
    expect(result.defects.length).toBe(0);
  });

  it("detects fractional physical border rasterization error at 1.25x and 1.75x DPR", () => {
    const result = validateSubpixelBorders({
      selector: ".hairline-card",
      bounds: { x: 10, y: 10, width: 100, height: 50 },
      borderWidth: 1,
      dprScales: [1.25, 1.75, 2.25],
    });

    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "subpixel-hairline-blur")).toBe(true);
    expect(result.remediations.length).toBeGreaterThan(0);
  });

  it("detects transform translation subpixel smearing", () => {
    const result = validateSubpixelBorders({
      selector: ".centered-popup",
      bounds: { x: 50, y: 50, width: 25, height: 25 },
      borderWidth: 1,
      transform: "translate(-50%, -50%)",
      dprScales: [1.0, 2.0],
    });

    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "subpixel-transform-smear")).toBe(true);
  });

  it("calculates physical rounding errors and parses complex transforms", () => {
    expect(getPhysicalRoundingError(1.5, 1.5)).toBe(0.25);
    expect(getPhysicalRoundingError(2.0, 1.5)).toBe(0);

    const trans = parseTransformTranslations("matrix(1, 0, 0, 1, 15.5, 20.25)");
    expect(trans.x).toBe(15.5);
    expect(trans.y).toBe(20.25);

    const norm = normalizeBorderWidths(1);
    expect(norm).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
  });

  it("evaluates snapToDevicePixels scalar and coordinate snapping across 1x, 1.5x, 2x, and 3x DPR scales", () => {
    expect(snapToDevicePixels(0.5, 1.0)).toBe(1.0);
    expect(snapToDevicePixels(0.2, 1.0)).toBe(0.0);
    expect(snapToDevicePixels(10.6, 1.0)).toBe(11.0);
    expect(snapToDevicePixels(10.4, 1.0)).toBe(10.0);

    expect(snapToDevicePixels(0.3333, 1.5)).toBeCloseTo(0, 4);
    expect(snapToDevicePixels(0.6667, 1.5)).toBeCloseTo(2 / 3, 3);
    expect(snapToDevicePixels(1.3333, 1.5)).toBeCloseTo(4 / 3, 3);
    expect(snapToDevicePixels(2.0, 1.5)).toBe(2.0);

    expect(snapToDevicePixels(0.25, 2.0)).toBe(0.5);
    expect(snapToDevicePixels(0.5, 2.0)).toBe(0.5);
    expect(snapToDevicePixels(0.75, 2.0)).toBe(1.0);
    expect(snapToDevicePixels(12.25, 2.0)).toBe(12.5);
    expect(snapToDevicePixels(12.5, 2.0)).toBe(12.5);

    expect(snapToDevicePixels(0.1667, 3.0)).toBeCloseTo(1 / 3, 3);
    expect(snapToDevicePixels(0.3333, 3.0)).toBeCloseTo(1 / 3, 3);
    expect(snapToDevicePixels(0.6667, 3.0)).toBeCloseTo(2 / 3, 3);
    expect(snapToDevicePixels(1.0, 3.0)).toBe(1.0);
    expect(snapToDevicePixels(1.3333, 3.0)).toBeCloseTo(4 / 3, 3);

    expect(snapToDevicePixels(15.75, 0)).toBe(15.75);
    expect(snapToDevicePixels(15.75, -2)).toBe(15.75);

    const rawBounds2x: SubpixelElementBounds = { x: 10.25, y: 20.75, width: 100.33, height: 50.66 };
    const snappedBounds2x = snapToDevicePixels(rawBounds2x, 2.0);
    expect(snappedBounds2x).toEqual({ x: 10.5, y: 21.0, width: 100.5, height: 50.5 });

    const rawBounds3x: SubpixelElementBounds = { x: 10.1, y: 20.2, width: 100.1, height: 50.2 };
    const snappedBounds3x = snapToDevicePixels(rawBounds3x, 3.0);
    expect(snappedBounds3x.x).toBe(10.0);
    expect(snappedBounds3x.y).toBeCloseTo(61 / 3, 3);
    expect(snappedBounds3x.width).toBe(100.0);
    expect(snappedBounds3x.height).toBeCloseTo(151 / 3, 3);
  });

  it("evaluates fractional CSS border widths (0.5px, 0.75px, 1.33px) detecting blurry vs crisp borders across DPR scales", () => {
    const border05 = validateSubpixelBorders({
      selector: ".hairline-05",
      bounds: { x: 0, y: 0, width: 120, height: 60 },
      borderWidth: 0.5,
      dprScales: [1.0, 1.5, 2.0, 3.0],
    });

    expect(border05.isCompliant).toBe(false);
    expect(border05.dprEvaluations[0]?.isAligned).toBe(false);
    expect(border05.dprEvaluations[1]?.isAligned).toBe(false);
    expect(border05.dprEvaluations[2]?.isAligned).toBe(true);
    expect(border05.dprEvaluations[3]?.isAligned).toBe(false);

    const border075 = validateSubpixelBorders({
      selector: ".border-075",
      bounds: { x: 0, y: 0, width: 120, height: 60 },
      borderWidth: 0.75,
      dprScales: [1.0, 1.5, 2.0, 3.0, 4.0],
    });

    expect(border075.dprEvaluations[0]?.isAligned).toBe(false);
    expect(border075.dprEvaluations[1]?.isAligned).toBe(false);
    expect(border075.dprEvaluations[2]?.isAligned).toBe(false);
    expect(border075.dprEvaluations[3]?.isAligned).toBe(false);
    expect(border075.dprEvaluations[4]?.isAligned).toBe(true);

    const border133 = validateSubpixelBorders({
      selector: ".border-133",
      bounds: { x: 0, y: 0, width: 120, height: 60 },
      borderWidth: 4 / 3,
      dprScales: [1.0, 1.5, 2.0, 3.0],
    });

    expect(border133.dprEvaluations[0]?.isAligned).toBe(false);
    expect(border133.dprEvaluations[1]?.isAligned).toBe(true);
    expect(border133.dprEvaluations[2]?.isAligned).toBe(false);
    expect(border133.dprEvaluations[3]?.isAligned).toBe(true);

    const border033 = validateSubpixelBorders({
      selector: ".hairline-retina-033",
      bounds: { x: 0, y: 0, width: 120, height: 60 },
      borderWidth: 1 / 3,
      dprScales: [1.0, 2.0, 3.0],
    });

    expect(border033.dprEvaluations[0]?.isAligned).toBe(false);
    expect(border033.dprEvaluations[1]?.isAligned).toBe(false);
    expect(border033.dprEvaluations[2]?.isAligned).toBe(true);
  });

  it("evaluates asymmetric fractional CSS border widths across diverse DPR values", () => {
    const asymmetricInput: SubpixelElementInput = {
      selector: ".card-asymmetric",
      bounds: { x: 20, y: 20, width: 240, height: 160 },
      borderWidth: { top: 0.5, right: 1.0, bottom: 0.5, left: 1.0 },
      dprScales: [1.0, 2.0],
    };

    const result2x = validateSubpixelBorders({ ...asymmetricInput, dprScales: [2.0] });
    expect(result2x.isCompliant).toBe(true);
    expect(result2x.defects.length).toBe(0);

    const result1x = validateSubpixelBorders({ ...asymmetricInput, dprScales: [1.0] });
    expect(result1x.isCompliant).toBe(false);
    expect(result1x.defects.some((d) => d.category === "subpixel-hairline-blur")).toBe(true);
  });

  it("verifies anti-aliasing edge contrast, fractional coverage, and hairline attenuation with evaluateAntiAliasingEdgeContrast", () => {
    const contrast05_1x = evaluateAntiAliasingEdgeContrast(0.5, 1.0, ".sub-pixel-hairline");
    expect(contrast05_1x.isCrisp).toBe(false);
    expect(contrast05_1x.physicalWidth).toBe(0.5);
    expect(contrast05_1x.edgeContrastFactor).toBe(0.5);
    expect(contrast05_1x.roundingError).toBe(0.5);
    expect(contrast05_1x.defect).toBeDefined();
    expect(contrast05_1x.defect?.severity).toBe("moderate");

    const contrast05_2x = evaluateAntiAliasingEdgeContrast(0.5, 2.0, ".sub-pixel-hairline");
    expect(contrast05_2x.isCrisp).toBe(true);
    expect(contrast05_2x.physicalWidth).toBe(1.0);
    expect(contrast05_2x.edgeContrastFactor).toBe(1.0);
    expect(contrast05_2x.roundingError).toBe(0.0);
    expect(contrast05_2x.defect).toBeUndefined();

    const contrast033_3x = evaluateAntiAliasingEdgeContrast(1 / 3, 3.0, ".retina-hairline");
    expect(contrast033_3x.isCrisp).toBe(true);
    expect(contrast033_3x.physicalWidth).toBe(1.0);
    expect(contrast033_3x.edgeContrastFactor).toBe(1.0);
    expect(contrast033_3x.roundingError).toBe(0.0);

    const contrast025_1x = evaluateAntiAliasingEdgeContrast(0.25, 1.0);
    expect(contrast025_1x.isCrisp).toBe(false);
    expect(contrast025_1x.physicalWidth).toBe(0.25);
    expect(contrast025_1x.edgeContrastFactor).toBe(0.25);

    const contrast15_1x = evaluateAntiAliasingEdgeContrast(1.5, 1.0);
    expect(contrast15_1x.isCrisp).toBe(false);
    expect(contrast15_1x.physicalWidth).toBe(1.5);
    expect(contrast15_1x.roundingError).toBe(0.5);
    expect(contrast15_1x.edgeContrastFactor).toBe(0.75);
    expect(contrast15_1x.defect?.severity).toBe("minor");

    const contrast0 = evaluateAntiAliasingEdgeContrast(0, 2.0);
    expect(contrast0.isCrisp).toBe(true);
    expect(contrast0.edgeContrastFactor).toBe(0);
    expect(contrast0.defect).toBeUndefined();
  });
});
