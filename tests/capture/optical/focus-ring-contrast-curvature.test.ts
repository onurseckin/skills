import { describe, expect, it } from "bun:test";
import { auditFocusRingContrast } from "../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/contrast.ts";
import { calculateOpticalCurvatureMetrics } from "../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/curvature.ts";
import {
  getSubpixelFraction,
  snapToDevicePixelRatio,
} from "../../../olt/scripts/src/capture/validator/mechanical/focus-ring-optical/snapping.ts";

describe("Focus Ring Optical Engine: Contrast, Curvature & Snapping", () => {
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
      const resBw = auditFocusRingContrast("#000000", "#ffffff", 3.0);
      expect(resBw.contrastRatio).toBeCloseTo(21.0, 1);
      expect(resBw.passes).toBe(true);

      const resLow = auditFocusRingContrast("#888888", "#999999", 3.0);
      expect(resLow.contrastRatio).toBeLessThan(3.0);
      expect(resLow.passes).toBe(false);

      const resCustom = auditFocusRingContrast("#2563eb", "#ffffff", 7.0);
      expect(resCustom.passes).toBe(false);
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
      expect(metrics.curvatureExponent).toBe(3.5);
      expect(metrics.hasG2Continuity).toBe(true);
    });

    it("defaults to circular Euclidean metrics when both smoothing and exponent are omitted", () => {
      const metrics = calculateOpticalCurvatureMetrics(8, 2, 10);
      expect(metrics.curvatureExponent).toBe(2.0);
      expect(metrics.smoothingFactor).toBe(0);
      expect(metrics.hasG2Continuity).toBe(false);
    });

    it("handles extreme or zero exponent values", () => {
      const metricsZero = calculateOpticalCurvatureMetrics(8, 2, 10, undefined, 0);
      expect(metricsZero.curvatureExponent).toBe(0);
      expect(metricsZero.hasG2Continuity).toBe(false);

      const metricsHigh = calculateOpticalCurvatureMetrics(8, 2, 10, undefined, 8.0);
      expect(metricsHigh.hasG2Continuity).toBe(false);
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
      expect(snapToDevicePixelRatio(10.333, 0)).toBe(10.333);
      expect(snapToDevicePixelRatio(10.333, -1)).toBe(10.333);

      expect(snapToDevicePixelRatio(10.3, 1.0)).toBe(10);
      expect(snapToDevicePixelRatio(10.7, 1.0)).toBe(11);

      expect(snapToDevicePixelRatio(10.2, 2.0)).toBe(10);
      expect(snapToDevicePixelRatio(10.3, 2.0)).toBe(10.5);
      expect(snapToDevicePixelRatio(10.8, 2.0)).toBe(11);
    });
  });
});
