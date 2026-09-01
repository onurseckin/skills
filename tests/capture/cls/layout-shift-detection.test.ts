import { describe, expect, it } from "bun:test";
import {
  calculateDistanceFraction,
  calculateImpactFraction,
  calculateLayoutShiftScore,
  clipRectToViewport,
  computeRectanglesUnionArea,
} from "../../../olt/scripts/src/capture/runners/index.ts";
import type { AABB } from "../../../olt/scripts/src/capture/runners/types.ts";

function box(x: number, y: number, width: number, height: number): AABB {
  return { x, y, width, height, left: x, right: x + width, top: y, bottom: y + height };
}

describe("layout-shift-tracker: geometric primitives & shift calculation", () => {
  describe("clipRectToViewport", () => {
    it("clips rectangles correctly against viewport boundaries", () => {
      const inside = box(100, 100, 200, 200);
      expect(clipRectToViewport(inside, 1000, 1000)).toEqual(box(100, 100, 200, 200));

      const overflow = box(800, 900, 400, 300);
      expect(clipRectToViewport(overflow, 1000, 1000)).toEqual(box(800, 900, 200, 100));

      const negative = box(-50, -100, 200, 200);
      expect(clipRectToViewport(negative, 1000, 1000)).toEqual(box(0, 0, 150, 100));
    });

    it("returns null for non-positive dimensions or non-positive viewport", () => {
      expect(clipRectToViewport({ x: 0, y: 0, width: 0, height: 100 }, 1000, 1000)).toBeNull();
      expect(clipRectToViewport({ x: 0, y: 0, width: 100, height: -10 }, 1000, 1000)).toBeNull();
      expect(clipRectToViewport({ x: 0, y: 0, width: 100, height: 100 }, 0, 1000)).toBeNull();
      expect(clipRectToViewport({ x: 0, y: 0, width: 100, height: 100 }, 1000, 0)).toBeNull();
      expect(clipRectToViewport({ x: 0, y: 0, width: 100, height: 100 }, -10, -20)).toBeNull();
    });

    it("returns null for rects completely outside viewport", () => {
      expect(
        clipRectToViewport({ x: 1100, y: 100, width: 100, height: 100 }, 1000, 1000),
      ).toBeNull();
      expect(
        clipRectToViewport({ x: 100, y: 1100, width: 100, height: 100 }, 1000, 1000),
      ).toBeNull();
      expect(
        clipRectToViewport({ x: -200, y: 100, width: 100, height: 100 }, 1000, 1000),
      ).toBeNull();
      expect(
        clipRectToViewport({ x: 100, y: -200, width: 100, height: 100 }, 1000, 1000),
      ).toBeNull();
    });

    it("clips rects with left/top/right/bottom properties correctly", () => {
      const rect = box(900, 900, 200, 200);
      expect(clipRectToViewport(rect, 1000, 1000)).toEqual(box(900, 900, 100, 100));
    });
  });

  describe("computeRectanglesUnionArea", () => {
    it("returns 0 for empty rectangle list or invalid rects", () => {
      expect(computeRectanglesUnionArea([])).toBe(0);
      expect(computeRectanglesUnionArea([{ x: 10, y: 20, width: 0, height: 40 }])).toBe(0);
      expect(computeRectanglesUnionArea([{ x: 10, y: 20, width: -10, height: 40 }])).toBe(0);
      const invalidRect = box(10, 10, 0, 10);
      expect(computeRectanglesUnionArea([invalidRect, invalidRect])).toBe(0);
    });

    it("computes union area for single and non-overlapping rectangles", () => {
      expect(computeRectanglesUnionArea([{ x: 10, y: 20, width: 50, height: 40 }])).toBe(2000);
      expect(computeRectanglesUnionArea([box(0, 0, 10, 10), box(20, 20, 10, 10)])).toBe(200);
    });

    it("computes union of overlapping rectangles without double counting", () => {
      expect(computeRectanglesUnionArea([box(0, 0, 10, 10), box(5, 0, 10, 10)])).toBe(150);
    });

    it("handles nested and multiple disjoint slices and vertical interval merges", () => {
      const r1 = box(0, 0, 100, 100);
      const r2 = box(20, 20, 40, 40);
      const r3 = box(50, 50, 100, 100);
      expect(computeRectanglesUnionArea([r1, r2, r3])).toBe(17500);

      const rTop = box(0, 0, 100, 50);
      const rBottom = box(0, 100, 100, 50);
      expect(computeRectanglesUnionArea([rTop, rBottom])).toBe(10000);
    });
  });

  describe("calculateImpactFraction & calculateDistanceFraction", () => {
    it("returns 0 for non-positive viewport or empty pairs", () => {
      expect(calculateImpactFraction([], { width: 1000, height: 1000 })).toBe(0);
      expect(
        calculateImpactFraction(
          [{ previousRect: box(0, 0, 10, 10), currentRect: box(0, 0, 10, 10) }],
          { width: 0, height: 1000 },
        ),
      ).toBe(0);
    });

    it("calculates accurate impact fraction for valid moving rect", () => {
      const pair = {
        previousRect: box(0, 0, 1000, 200),
        currentRect: box(0, 100, 1000, 200),
      };
      expect(calculateImpactFraction([pair], { width: 1000, height: 1000 })).toBeCloseTo(0.3, 5);
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
