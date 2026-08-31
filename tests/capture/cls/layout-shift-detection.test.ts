import { describe, expect, it } from "bun:test";
import {
  calculateDistanceFraction,
  calculateImpactFraction,
  calculateLayoutShiftScore,
  clipRectToViewport,
  computeRectanglesUnionArea,
} from "../../../olt/scripts/src/capture/runners/index.ts";
import type { AABB } from "../../../olt/scripts/src/capture/runners/types.ts";

describe("layout-shift-tracker: geometric primitives & shift calculation", () => {
  describe("clipRectToViewport", () => {
    it("clips rectangles correctly against viewport boundaries", () => {
      const inside: AABB = {
        x: 100, y: 100, width: 200, height: 200,
        left: 100, right: 300, top: 100, bottom: 300,
      };
      const clippedInside = clipRectToViewport(inside, 1000, 1000);
      expect(clippedInside).toEqual({
        x: 100, y: 100, width: 200, height: 200,
        left: 100, right: 300, top: 100, bottom: 300,
      });

      const overflowRightBottom: AABB = {
        x: 800, y: 900, width: 400, height: 300,
        left: 800, right: 1200, top: 900, bottom: 1200,
      };
      const clippedOverflow = clipRectToViewport(overflowRightBottom, 1000, 1000);
      expect(clippedOverflow).toEqual({
        x: 800, y: 900, width: 200, height: 100,
        left: 800, right: 1000, top: 900, bottom: 1000,
      });

      const negativeTopLeft: AABB = {
        x: -50, y: -100, width: 200, height: 200,
        left: -50, right: 150, top: -100, bottom: 100,
      };
      const clippedNegative = clipRectToViewport(negativeTopLeft, 1000, 1000);
      expect(clippedNegative).toEqual({
        x: 0, y: 0, width: 150, height: 100,
        left: 0, right: 150, top: 0, bottom: 100,
      });
    });

    it("returns null for non-positive dimensions or non-positive viewport", () => {
      expect(clipRectToViewport({ x: 0, y: 0, width: 0, height: 100 }, 1000, 1000)).toBeNull();
      expect(clipRectToViewport({ x: 0, y: 0, width: 100, height: -10 }, 1000, 1000)).toBeNull();
      expect(clipRectToViewport({ x: 0, y: 0, width: 100, height: 100 }, 0, 1000)).toBeNull();
      expect(clipRectToViewport({ x: 0, y: 0, width: 100, height: 100 }, 1000, 0)).toBeNull();
      expect(clipRectToViewport({ x: 0, y: 0, width: 100, height: 100 }, -10, -20)).toBeNull();
    });

    it("returns null for rects completely outside viewport", () => {
      expect(clipRectToViewport({ x: 1100, y: 100, width: 100, height: 100 }, 1000, 1000)).toBeNull();
      expect(clipRectToViewport({ x: 100, y: 1100, width: 100, height: 100 }, 1000, 1000)).toBeNull();
      expect(clipRectToViewport({ x: -200, y: 100, width: 100, height: 100 }, 1000, 1000)).toBeNull();
      expect(clipRectToViewport({ x: 100, y: -200, width: 100, height: 100 }, 1000, 1000)).toBeNull();
    });

    it("clips rects with left/top/right/bottom properties correctly", () => {
      const rect: AABB = {
        x: 900, y: 900, width: 200, height: 200,
        left: 900, top: 900, right: 1100, bottom: 1100,
      };
      const clipped = clipRectToViewport(rect, 1000, 1000);
      expect(clipped).toEqual({
        x: 900, y: 900, width: 100, height: 100,
        left: 900, top: 900, right: 1000, bottom: 1000,
      });
    });
  });

  describe("computeRectanglesUnionArea", () => {
    it("returns 0 for empty rectangle list or invalid rects", () => {
      expect(computeRectanglesUnionArea([])).toBe(0);
      expect(computeRectanglesUnionArea([{ x: 10, y: 20, width: 0, height: 40 }])).toBe(0);
      expect(computeRectanglesUnionArea([{ x: 10, y: 20, width: -10, height: 40 }])).toBe(0);
      const invalidRect: AABB = {
        x: 10, y: 10, width: 0, left: 10, right: 10, top: 10, bottom: 20, height: 10,
      };
      expect(computeRectanglesUnionArea([invalidRect, invalidRect])).toBe(0);
    });

    it("computes union area for single and non-overlapping rectangles", () => {
      expect(computeRectanglesUnionArea([{ x: 10, y: 20, width: 50, height: 40 }])).toBe(2000);
      const r1: AABB = { x: 0, y: 0, width: 10, height: 10, left: 0, right: 10, top: 0, bottom: 10 };
      const r2: AABB = { x: 20, y: 20, width: 10, height: 10, left: 20, right: 30, top: 20, bottom: 30 };
      expect(computeRectanglesUnionArea([r1, r2])).toBe(200);
    });

    it("computes union of overlapping rectangles without double counting", () => {
      const r1: AABB = { x: 0, y: 0, width: 10, height: 10, left: 0, right: 10, top: 0, bottom: 10 };
      const r2: AABB = { x: 5, y: 0, width: 10, height: 10, left: 5, right: 15, top: 0, bottom: 10 };
      expect(computeRectanglesUnionArea([r1, r2])).toBe(150);
    });

    it("handles nested and multiple disjoint slices and vertical interval merges", () => {
      const r1: AABB = { x: 0, y: 0, width: 100, height: 100, left: 0, right: 100, top: 0, bottom: 100 };
      const r2: AABB = { x: 20, y: 20, width: 40, height: 40, left: 20, right: 60, top: 20, bottom: 60 };
      const r3: AABB = { x: 50, y: 50, width: 100, height: 100, left: 50, right: 150, top: 50, bottom: 150 };
      expect(computeRectanglesUnionArea([r1, r2, r3])).toBe(17500);

      const rTop: AABB = { x: 0, y: 0, width: 100, height: 50, left: 0, right: 100, top: 0, bottom: 50 };
      const rBottom: AABB = { x: 0, y: 100, width: 100, height: 50, left: 0, right: 100, top: 100, bottom: 150 };
      expect(computeRectanglesUnionArea([rTop, rBottom])).toBe(10000);
    });
  });

  describe("calculateImpactFraction & calculateDistanceFraction", () => {
    it("returns 0 for non-positive viewport or empty pairs", () => {
      expect(calculateImpactFraction([], { width: 1000, height: 1000 })).toBe(0);
      expect(
        calculateImpactFraction(
          [
            {
              previousRect: { x: 0, y: 0, width: 10, height: 10 },
              currentRect: { x: 0, y: 0, width: 10, height: 10 },
            },
          ],
          { width: 0, height: 1000 },
        ),
      ).toBe(0);
    });

    it("calculates accurate impact fraction for valid moving rect", () => {
      const pair = {
        previousRect: {
          x: 0, y: 0, width: 1000, height: 200, left: 0, right: 1000, top: 0, bottom: 200,
        },
        currentRect: {
          x: 0, y: 100, width: 1000, height: 200, left: 0, right: 1000, top: 100, bottom: 300,
        },
      };
      const impact = calculateImpactFraction([pair], { width: 1000, height: 1000 });
      expect(impact).toBeCloseTo(0.3, 5);
    });

    it("calculates distance fraction against max dimension and clamps to 1", () => {
      expect(calculateDistanceFraction(0, { width: 1000, height: 1000 })).toBe(0);
      expect(calculateDistanceFraction(200, { width: 1000, height: 500 })).toBe(0.2);
      expect(calculateDistanceFraction(1500, { width: 1000, height: 500 })).toBe(1);
    });

    it("multiplies impactFraction and distanceFraction and clamps non-negative", () => {
      expect(calculateLayoutShiftScore(0.5, 0.2)).toBeCloseTo(0.1, 5);
      expect(calculateLayoutShiftScore(Number.NaN, 0.2)).toBe(0);
      expect(calculateLayoutShiftScore(-0.5, 0.2)).toBe(0);
    });
  });
});
