import { describe, expect, it } from "bun:test";
import {
  NAMED_COLORS,
  calculateWcagLuminance,
  compositeColorOver,
  hslToRgb,
  parseCssColor,
  srgbChannelToLinear,
} from "../../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/color.ts";
import {
  calculateConcentricRadius,
  validateNestedConcentricCorners,
} from "../../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/concentricity.ts";
import { auditFocusRingContrast } from "../../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/contrast.ts";
import { calculateOpticalCurvatureMetrics } from "../../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/curvature.ts";
import { validateFocusRingOpticalSnapping } from "../../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/evaluator.ts";
import {
  getSubpixelFraction,
  snapToDevicePixelRatio,
} from "../../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/snapping.ts";
import type { FocusRingGeometry } from "../../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/types.ts";

describe("Focus Ring Optical Engine", () => {
  describe("Color Parsing & Luminance (color.ts)", () => {
    it("exports NAMED_COLORS map with standard colors", () => {
      expect(NAMED_COLORS.white).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(NAMED_COLORS.black).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(NAMED_COLORS.transparent).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(NAMED_COLORS.currentcolor).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(NAMED_COLORS.red).toEqual({ r: 239, g: 68, b: 68, a: 1 });
      expect(NAMED_COLORS.blue).toEqual({ r: 37, g: 99, b: 235, a: 1 });
      expect(NAMED_COLORS.slate).toEqual({ r: 100, g: 116, b: 139, a: 1 });
    });

    it("hslToRgb converts all 6 hue sectors, negative angles, and boundary conditions", () => {
      // Sector 1: 0 - 60 (Red to Yellow)
      const red = hslToRgb(0, 100, 50);
      expect(red).toEqual({ r: 255, g: 0, b: 0 });

      const orange = hslToRgb(30, 100, 50);
      expect(orange.r).toBe(255);
      expect(orange.g).toBe(128);
      expect(orange.b).toBe(0);

      // Sector 2: 60 - 120 (Yellow to Green)
      const yellow = hslToRgb(60, 100, 50);
      expect(yellow).toEqual({ r: 255, g: 255, b: 0 });

      const chartreuse = hslToRgb(90, 100, 50);
      expect(chartreuse.r).toBe(128);
      expect(chartreuse.g).toBe(255);
      expect(chartreuse.b).toBe(0);

      // Sector 3: 120 - 180 (Green to Cyan)
      const green = hslToRgb(120, 100, 50);
      expect(green).toEqual({ r: 0, g: 255, b: 0 });

      const spring = hslToRgb(150, 100, 50);
      expect(spring.r).toBe(0);
      expect(spring.g).toBe(255);
      expect(spring.b).toBe(128);

      // Sector 4: 180 - 240 (Cyan to Blue)
      const cyan = hslToRgb(180, 100, 50);
      expect(cyan).toEqual({ r: 0, g: 255, b: 255 });

      const azure = hslToRgb(210, 100, 50);
      expect(azure.r).toBe(0);
      expect(azure.g).toBe(128);
      expect(azure.b).toBe(255);

      // Sector 5: 240 - 300 (Blue to Magenta)
      const blue = hslToRgb(240, 100, 50);
      expect(blue).toEqual({ r: 0, g: 0, b: 255 });

      const violet = hslToRgb(270, 100, 50);
      expect(violet.r).toBe(128);
      expect(violet.g).toBe(0);
      expect(violet.b).toBe(255);

      // Sector 6: 300 - 360 (Magenta to Red)
      const magenta = hslToRgb(300, 100, 50);
      expect(magenta).toEqual({ r: 255, g: 0, b: 255 });

      const rose = hslToRgb(330, 100, 50);
      expect(rose.r).toBe(255);
      expect(rose.g).toBe(0);
      expect(rose.b).toBe(128);

      // Negative angles and angles >= 360
      const negAngle = hslToRgb(-120, 100, 50); // Equivalent to 240 (Blue)
      expect(negAngle).toEqual({ r: 0, g: 0, b: 255 });

      const wrapAngle = hslToRgb(480, 100, 50); // Equivalent to 120 (Green)
      expect(wrapAngle).toEqual({ r: 0, g: 255, b: 0 });

      // Extreme saturation and lightness
      const black = hslToRgb(0, 0, 0);
      expect(black).toEqual({ r: 0, g: 0, b: 0 });

      const white = hslToRgb(0, 0, 100);
      expect(white).toEqual({ r: 255, g: 255, b: 255 });
    });

    it("parseCssColor parses all hex formats (#rgb, #rgba, #rrggbb, #rrggbbaa)", () => {
      // #rgb
      expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseCssColor("#000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseCssColor("#f0a")).toEqual({ r: 255, g: 0, b: 170, a: 1 });

      // #rgba
      const hex4 = parseCssColor("#ff08");
      expect(hex4?.r).toBe(255);
      expect(hex4?.g).toBe(255);
      expect(hex4?.b).toBe(0);
      expect(hex4?.a).toBeCloseTo(0.5333, 3);

      // #rrggbb
      expect(parseCssColor("#102030")).toEqual({ r: 16, g: 32, b: 48, a: 1 });

      // #rrggbbaa
      const hex8 = parseCssColor("#10203080");
      expect(hex8?.r).toBe(16);
      expect(hex8?.g).toBe(32);
      expect(hex8?.b).toBe(48);
      expect(hex8?.a).toBeCloseTo(128 / 255, 4);
    });

    it("parseCssColor parses named colors and returns null on invalid strings", () => {
      expect(parseCssColor("red")).toEqual(NAMED_COLORS.red);
      expect(parseCssColor("  BLUE  ")).toEqual(NAMED_COLORS.blue);
      expect(parseCssColor("")).toBeNull();
      expect(parseCssColor(undefined)).toBeNull();
      expect(parseCssColor("not-a-color")).toBeNull();
      expect(parseCssColor("#invalid")).toBeNull();
    });

    it("parseCssColor parses rgb and rgba syntax with commas, spaces, slashes, and percentages", () => {
      // Comma separated
      expect(parseCssColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
      expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
      expect(parseCssColor("rgba(10, 20, 30, 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });

      // Space separated / slash syntax
      expect(parseCssColor("rgb(255 128 0)")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
      expect(parseCssColor("rgb(255 128 0 / 0.8)")).toEqual({ r: 255, g: 128, b: 0, a: 0.8 });
      expect(parseCssColor("rgb(255 128 0 / 75%)")).toEqual({ r: 255, g: 128, b: 0, a: 0.75 });

      // Out of bounds clamping
      expect(parseCssColor("rgb(300, 50, 100)")).toEqual({ r: 255, g: 50, b: 100, a: 1 });
    });

    it("parseCssColor parses hsl and hsla syntax", () => {
      const hsl1 = parseCssColor("hsl(120, 100%, 50%)");
      expect(hsl1).toEqual({ r: 0, g: 255, b: 0, a: 1 });

      const hsla1 = parseCssColor("hsla(120deg, 100%, 50%, 0.4)");
      expect(hsla1).toEqual({ r: 0, g: 255, b: 0, a: 0.4 });

      const hslaSlash = parseCssColor("hsl(240 100% 50% / 60%)");
      expect(hslaSlash).toEqual({ r: 0, g: 0, b: 255, a: 0.6 });
    });

    it("compositeColorOver blends foreground and background properly", () => {
      // Solid foreground returns foreground unchanged
      const solidFg = { r: 255, g: 0, b: 0, a: 1 };
      const bg = { r: 0, g: 0, b: 255, a: 1 };
      expect(compositeColorOver(solidFg, bg)).toEqual(solidFg);

      // Semi-transparent foreground (50% red over 100% blue)
      const semiFg = { r: 255, g: 0, b: 0, a: 0.5 };
      const blended = compositeColorOver(semiFg, bg);
      expect(blended.r).toBe(128);
      expect(blended.g).toBe(0);
      expect(blended.b).toBe(128);
      expect(blended.a).toBe(1);

      // Semi-transparent foreground over semi-transparent background
      const semiBg = { r: 0, g: 255, b: 0, a: 0.5 };
      const blendedSemi = compositeColorOver(semiFg, semiBg);
      expect(blendedSemi.a).toBeCloseTo(0.75, 2);
    });

    it("srgbChannelToLinear and calculateWcagLuminance adhere to WCAG standards", () => {
      // sRGB threshold test: c <= 0.04045 vs > 0.04045
      // 5 / 255 = 0.0196 <= 0.04045
      const lowLinear = srgbChannelToLinear(5);
      expect(lowLinear).toBeCloseTo(5 / 255 / 12.92, 5);

      // 255 / 255 = 1.0 > 0.04045 -> 1.0
      const highLinear = srgbChannelToLinear(255);
      expect(highLinear).toBeCloseTo(1.0, 5);

      // Luminance of black = 0, white = 1
      expect(calculateWcagLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
      expect(calculateWcagLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1.0, 4);

      // Relative weights: Green > Red > Blue
      const lumRed = calculateWcagLuminance({ r: 255, g: 0, b: 0, a: 1 });
      const lumGreen = calculateWcagLuminance({ r: 0, g: 255, b: 0, a: 1 });
      const lumBlue = calculateWcagLuminance({ r: 0, g: 0, b: 255, a: 1 });

      expect(lumRed).toBeCloseTo(0.2126, 3);
      expect(lumGreen).toBeCloseTo(0.7152, 3);
      expect(lumBlue).toBeCloseTo(0.0722, 3);
    });
  });

  describe("Concentricity Calculations (concentricity.ts)", () => {
    it("calculateConcentricRadius computes outer radius correctly and clamps negative results", () => {
      expect(calculateConcentricRadius(8, 4)).toBe(12);
      expect(calculateConcentricRadius(0, 4)).toBe(4);
      expect(calculateConcentricRadius(-5, 2)).toBe(0);
      expect(calculateConcentricRadius(8, -12)).toBe(0);
    });

    it("validateNestedConcentricCorners validates concentric corners and reports optical compensation", () => {
      // Concentric case
      const resPass = validateNestedConcentricCorners(12, 8, 4, 1.0);
      expect(resPass.isConcentric).toBe(true);
      expect(resPass.delta).toBe(0);
      expect(resPass.expectedOuterRadius).toBe(12);
      expect(resPass.opticalCorrection).toBeCloseTo((Math.SQRT2 - 1) * 4, 3);
      expect(resPass.details).toContain("Corners are concentric within tolerance");

      // Mismatch case
      const resFail = validateNestedConcentricCorners(8, 8, 4, 1.0);
      expect(resFail.isConcentric).toBe(false);
      expect(resFail.delta).toBe(4);
      expect(resFail.details).toContain("Concentric corner mismatch");

      // Zero or negative padding in optical compensation
      const resZeroPad = validateNestedConcentricCorners(8, 8, 0, 1.0);
      expect(resZeroPad.opticalCorrection).toBe(0);
    });
  });

  describe("Contrast Audit (contrast.ts)", () => {
    it("returns default failure when colors cannot be parsed", () => {
      const res = auditFocusRingContrast("invalid-color-1", "#ffffff");
      expect(res.contrastRatio).toBe(1.0);
      expect(res.passes).toBe(false);

      const res2 = auditFocusRingContrast("#000000", "invalid-bg-2");
      expect(res2.contrastRatio).toBe(1.0);
      expect(res2.passes).toBe(false);
    });

    it("computes accurate contrast ratios and evaluates pass/fail verdicts", () => {
      // Black on White: ~21:1
      const resBw = auditFocusRingContrast("#000000", "#ffffff", 3.0);
      expect(resBw.contrastRatio).toBeCloseTo(21.0, 1);
      expect(resBw.passes).toBe(true);

      // Low contrast: gray on slightly lighter gray
      const resLow = auditFocusRingContrast("#888888", "#999999", 3.0);
      expect(resLow.contrastRatio).toBeLessThan(3.0);
      expect(resLow.passes).toBe(false);

      // Custom target contrast threshold
      const resCustom = auditFocusRingContrast("#2563eb", "#ffffff", 7.0);
      expect(resCustom.passes).toBe(false); // ~4.5:1 is < 7.0:1
    });
  });

  describe("Optical Curvature Smoothing (curvature.ts)", () => {
    it("calculates metrics with explicit exponent", () => {
      const metrics = calculateOpticalCurvatureMetrics(8, 2, 10, undefined, 4.0);
      expect(metrics.curvatureExponent).toBe(4.0);
      expect(metrics.smoothingFactor).toBeCloseTo((4.0 - 2.0) / 3.0, 3);
      expect(metrics.hasG2Continuity).toBe(true);
      expect(metrics.nonEuclideanDelta).toBeGreaterThan(0);
      expect(metrics.cornerArcLengthCorrection).toBeGreaterThan(1.0);
    });

    it("calculates metrics with smoothing factor", () => {
      const metrics = calculateOpticalCurvatureMetrics(8, 2, 10, 0.5);
      expect(metrics.smoothingFactor).toBe(0.5);
      expect(metrics.curvatureExponent).toBe(3.5); // 2.0 + 3.0 * 0.5
      expect(metrics.hasG2Continuity).toBe(true);
    });

    it("defaults to circular Euclidean metrics when both smoothing and exponent are omitted", () => {
      const metrics = calculateOpticalCurvatureMetrics(8, 2, 10);
      expect(metrics.curvatureExponent).toBe(2.0);
      expect(metrics.smoothingFactor).toBe(0);
      expect(metrics.hasG2Continuity).toBe(false); // 2.0 < 2.5
    });

    it("handles extreme or zero exponent values", () => {
      const metricsZero = calculateOpticalCurvatureMetrics(8, 2, 10, undefined, 0);
      expect(metricsZero.curvatureExponent).toBe(0);
      expect(metricsZero.hasG2Continuity).toBe(false);

      const metricsHigh = calculateOpticalCurvatureMetrics(8, 2, 10, undefined, 8.0);
      expect(metricsHigh.hasG2Continuity).toBe(false); // 8.0 > 6.0
    });
  });

  describe("Snapping Utilities (snapping.ts)", () => {
    it("getSubpixelFraction returns distance to nearest integer", () => {
      expect(getSubpixelFraction(10.0)).toBe(0);
      expect(getSubpixelFraction(10.25)).toBe(0.25);
      expect(getSubpixelFraction(10.75)).toBeCloseTo(0.25, 4);
      expect(getSubpixelFraction(-10.25)).toBe(0.25);
    });

    it("snapToDevicePixelRatio snaps CSS pixels to physical device pixels", () => {
      // dpr <= 0 returns value unchanged
      expect(snapToDevicePixelRatio(10.333, 0)).toBe(10.333);
      expect(snapToDevicePixelRatio(10.333, -1)).toBe(10.333);

      // dpr = 1.0
      expect(snapToDevicePixelRatio(10.3, 1.0)).toBe(10);
      expect(snapToDevicePixelRatio(10.7, 1.0)).toBe(11);

      // dpr = 2.0 (0.5 increments)
      expect(snapToDevicePixelRatio(10.2, 2.0)).toBe(10);
      expect(snapToDevicePixelRatio(10.3, 2.0)).toBe(10.5);
      expect(snapToDevicePixelRatio(10.8, 2.0)).toBe(11);
    });
  });

  describe("Focus Ring Optical Evaluator (evaluator.ts)", () => {
    it("evaluates clean focus ring geometry with all checks passing", () => {
      const cleanRing: FocusRingGeometry = {
        elementBounds: { x: 100, y: 100, width: 200, height: 40 },
        elementBorderRadius: 8,
        ringOffset: 2,
        ringWidth: 2,
        ringRadius: 12, // 8 + 2 + 2 = 12 (exact concentric)
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
        ringRadius: 4, // Expected 12, delta is 8px
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
        ringWidth: 4, // Ring spans x = 2 to 118, y = 2 to 58
        clippingBounds: { x: 10, y: 10, width: 100, height: 40 }, // Clips ring on all 4 edges!
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
      // Low contrast
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

      // Colors omitted: default 21.0 contrast pass
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
});
