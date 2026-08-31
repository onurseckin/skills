import { describe, expect, it } from "bun:test";
import { validateFocusRingOpticalSnapping } from "../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/evaluator.ts";
import type { FocusRingGeometry } from "../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/types.ts";

describe("Focus Ring Optical Engine: Evaluator", () => {
  it("evaluates clean focus ring geometry with all checks passing", () => {
    const cleanRing: FocusRingGeometry = {
      elementBounds: { x: 100, y: 100, width: 200, height: 40 },
      elementBorderRadius: 8,
      ringOffset: 2,
      ringWidth: 2,
      ringRadius: 12,
      ringColor: "#000000",
      backgroundColor: "#ffffff",
      dpr: 2.0,
      opticalCurvatureSmoothing: 0.5,
      selector: "button.clean-btn",
    };

    const result = validateFocusRingOpticalSnapping(cleanRing);
    expect(result.passed).toBe(true);
    expect(result.defects.length).toBe(0);
    expect(result.concentricEvaluation.isConcentric).toBe(true);
    expect(result.contrastAudit.passes).toBe(true);
    expect(result.isClipped).toBe(false);
    expect(result.dprScaleResults.length).toBe(5);
  });

  it("detects concentric mismatch defects", () => {
    const ring: FocusRingGeometry = {
      elementBounds: { x: 100, y: 100, width: 200, height: 40 },
      elementBorderRadius: 8,
      ringOffset: 2,
      ringWidth: 2,
      ringRadius: 4,
      ringColor: "#000000",
      backgroundColor: "#ffffff",
      selector: "button.concentric-bad",
    };

    const result = validateFocusRingOpticalSnapping(ring);
    expect(result.passed).toBe(false);
    const concentricDefect = result.defects.find((d) => d.type === "concentric-mismatch");
    expect(concentricDefect).toBeDefined();
    expect(concentricDefect?.severity).toBe("moderate");
    expect(concentricDefect?.message).toContain("is not concentric");
  });

  it("detects subpixel raster misalignment across DPR scales", () => {
    const ring: FocusRingGeometry = {
      elementBounds: { x: 100.33, y: 100.33, width: 200.33, height: 40.33 },
      elementBorderRadius: 8,
      ringOffset: 2.33,
      ringWidth: 1.33,
      ringColor: "#000000",
      backgroundColor: "#ffffff",
      dpr: 1.0,
      selector: "button.subpixel-bad",
    };

    const result = validateFocusRingOpticalSnapping(ring, {
      subpixelTolerance: 0.01,
    });
    expect(result.passed).toBe(false);
    const subpixelDefect = result.defects.find((d) => d.type === "subpixel-misalignment");
    expect(subpixelDefect).toBeDefined();
    expect(subpixelDefect?.severity).toBe("minor");
    expect(subpixelDefect?.message).toContain("subpixel raster misalignment");
  });

  it("detects optical curvature distortion when exponent is < 1.0 or > 10.0", () => {
    const ring: FocusRingGeometry = {
      elementBounds: { x: 100, y: 100, width: 200, height: 40 },
      elementBorderRadius: 8,
      ringOffset: 2,
      ringWidth: 2,
      ringColor: "#000000",
      backgroundColor: "#ffffff",
      selector: "button.distorted",
    };

    const resultLow = validateFocusRingOpticalSnapping(ring, {
      curvatureExponent: 0.5,
    });
    expect(resultLow.passed).toBe(false);
    const distDefectLow = resultLow.defects.find((d) => d.type === "optical-distortion");
    expect(distDefectLow).toBeDefined();
    expect(distDefectLow?.severity).toBe("moderate");

    const resultHigh = validateFocusRingOpticalSnapping(ring, {
      curvatureExponent: 12.0,
    });
    const distDefectHigh = resultHigh.defects.find((d) => d.type === "optical-distortion");
    expect(distDefectHigh).toBeDefined();
  });

  it("detects clipping boundary overflow when ring extends outside container", () => {
    const ring: FocusRingGeometry = {
      elementBounds: { x: 10, y: 10, width: 100, height: 40 },
      elementBorderRadius: 4,
      ringOffset: 4,
      ringWidth: 4,
      clippingBounds: { x: 10, y: 10, width: 100, height: 40 },
      ringColor: "#000000",
      backgroundColor: "#ffffff",
      selector: "button.clipped-btn",
    };

    const result = validateFocusRingOpticalSnapping(ring, { checkClipping: true });
    expect(result.passed).toBe(false);
    expect(result.isClipped).toBe(true);
    expect(result.clippingOverlap).toBeDefined();
    expect(result.clippingOverlap?.topOverflow).toBeGreaterThan(0);
    expect(result.clippingOverlap?.leftOverflow).toBeGreaterThan(0);
    expect(result.clippingOverlap?.rightOverflow).toBeGreaterThan(0);
    expect(result.clippingOverlap?.bottomOverflow).toBeGreaterThan(0);

    const clipDefect = result.defects.find((d) => d.type === "clipping-overflow");
    expect(clipDefect).toBeDefined();
    expect(clipDefect?.severity).toBe("serious");
  });

  it("skips clipping checks when checkClipping is false", () => {
    const ring: FocusRingGeometry = {
      elementBounds: { x: 10, y: 10, width: 100, height: 40 },
      elementBorderRadius: 4,
      ringOffset: 4,
      ringWidth: 4,
      clippingBounds: { x: 10, y: 10, width: 100, height: 40 },
      selector: "button.unclipped-option",
    };

    const result = validateFocusRingOpticalSnapping(ring, { checkClipping: false });
    expect(result.isClipped).toBe(false);
    expect(result.defects.some((d) => d.type === "clipping-overflow")).toBe(false);
  });

  it("detects insufficient contrast defects and defaults contrast when colors are omitted", () => {
    const ringLowContrast: FocusRingGeometry = {
      elementBounds: { x: 100, y: 100, width: 200, height: 40 },
      elementBorderRadius: 8,
      ringOffset: 2,
      ringWidth: 2,
      ringColor: "#cccccc",
      backgroundColor: "#ffffff",
      selector: "button.low-contrast",
    };

    const resultLow = validateFocusRingOpticalSnapping(ringLowContrast, { targetContrast: 3.0 });
    expect(resultLow.passed).toBe(false);
    const contrastDefect = resultLow.defects.find((d) => d.type === "insufficient-contrast");
    expect(contrastDefect).toBeDefined();
    expect(contrastDefect?.severity).toBe("serious");

    const ringNoColors: FocusRingGeometry = {
      elementBounds: { x: 100, y: 100, width: 200, height: 40 },
      elementBorderRadius: 8,
      ringOffset: 2,
      ringWidth: 2,
    };
    const resultNoColor = validateFocusRingOpticalSnapping(ringNoColors);
    expect(resultNoColor.contrastAudit.passes).toBe(true);
    expect(resultNoColor.contrastAudit.contrastRatio).toBe(21.0);
  });

  it("handles empty supportedDprScales by computing direct snapped bounds", () => {
    const ring: FocusRingGeometry = {
      elementBounds: { x: 100, y: 100, width: 200, height: 40 },
      elementBorderRadius: 8,
      ringOffset: 2,
      ringWidth: 2,
      dpr: 2.0,
    };

    const result = validateFocusRingOpticalSnapping(ring, { supportedDprScales: [] });
    expect(result.snappedRingBounds).toBeDefined();
    expect(result.snappedRingBounds.x).toBe(96);
    expect(result.dprScaleResults.length).toBe(0);
  });
});
