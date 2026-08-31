import { describe, expect, it } from "bun:test";
import {
  buildCumulativeLayoutShiftReport,
  calculateDistanceFraction,
  calculateImpactFraction,
  calculateLayoutShiftScore,
  clipRectToViewport,
  computeRectanglesUnionArea,
  DEFAULT_LAYOUT_SHIFT_OPTIONS,
  detectLayoutShiftBetweenSnapshots,
  groupSessionWindows,
  identifyRootCausingElements,
  LayoutShiftTracker,
  resolveLayoutShiftTrackerOptions,
  type LayoutShiftEntry,
  type UnstableElementDisplacement,
} from "../../../../olt/scripts/src/capture/runners/layout-shift-tracker/index.ts";
import type {
  AABB,
  DomPhysicsSnapshot,
  ExtractedElementPhysics,
} from "../../../../olt/scripts/src/capture/runners/types.ts";

function createMockElement(
  selector: string,
  tagName: string,
  bounds: { x: number; y: number; width: number; height: number },
  styles: { position?: string; display?: string } = {},
): ExtractedElementPhysics {
  return {
    selector,
    tagName,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      top: bounds.y,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height,
      left: bounds.x,
    },
    computedStyles: {
      display: styles.display ?? "block",
      position: styles.position ?? "static",
      zIndex: 0,
      color: "#000000",
      backgroundColor: "#ffffff",
      overflowX: "visible",
      overflowY: "visible",
    },
    metrics: {
      scrollWidth: bounds.width,
      clientWidth: bounds.width,
      scrollHeight: bounds.height,
      clientHeight: bounds.height,
      offsetWidth: bounds.width,
      offsetHeight: bounds.height,
    },
  };
}

function createMockSnapshot(
  elements: readonly ExtractedElementPhysics[],
  viewport: { width: number; height: number } = { width: 1000, height: 1000 },
): DomPhysicsSnapshot {
  return {
    viewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    },
    scrollPosition: { x: 0, y: 0 },
    elements,
    layoutOverflows: [],
    textClippings: [],
    capturedAt: new Date().toISOString(),
  };
}

function createSampleShiftEntry(
  id: string,
  timestamp: number,
  score: number,
  isValidShift = true,
  rootCauses: UnstableElementDisplacement[] = [],
): LayoutShiftEntry {
  return {
    id,
    timestamp,
    impactFraction: score > 0 ? 0.5 : 0,
    distanceFraction: score > 0 ? score / 0.5 : 0,
    score,
    hadRecentInput: false,
    sources: [],
    rootCauses,
    viewport: { width: 1000, height: 1000 },
    isValidShift,
  };
}

describe("layout-shift-tracker", () => {
  describe("options", () => {
    it("resolveLayoutShiftTrackerOptions returns defaults when no options passed", () => {
      const resolved = resolveLayoutShiftTrackerOptions();
      expect(resolved).toEqual(DEFAULT_LAYOUT_SHIFT_OPTIONS);
    });

    it("resolveLayoutShiftTrackerOptions overrides provided fields", () => {
      const resolved = resolveLayoutShiftTrackerOptions({
        subpixelTolerance: 1.0,
        userInputWindowMs: 1000,
        sessionMaxDurationMs: 8000,
        sessionMaxGapMs: 2000,
        excludeFixedSticky: false,
        excludeTransformOnly: false,
        excludeOpacityOnly: false,
        ignoreUserInputShifts: false,
      });

      expect(resolved).toEqual({
        subpixelTolerance: 1.0,
        userInputWindowMs: 1000,
        sessionMaxDurationMs: 8000,
        sessionMaxGapMs: 2000,
        excludeFixedSticky: false,
        excludeTransformOnly: false,
        excludeOpacityOnly: false,
        ignoreUserInputShifts: false,
      });
    });
  });

  describe("geometry", () => {
    describe("clipRectToViewport", () => {
      it("returns null for non-positive viewport dimensions", () => {
        const rect: AABB = { x: 0, y: 0, width: 100, height: 100 };
        expect(clipRectToViewport(rect, 0, 100)).toBeNull();
        expect(clipRectToViewport(rect, 100, 0)).toBeNull();
        expect(clipRectToViewport(rect, -10, -20)).toBeNull();
      });

      it("returns null for rects completely outside viewport", () => {
        const outsideRight: AABB = { x: 1100, y: 100, width: 100, height: 100 };
        expect(clipRectToViewport(outsideRight, 1000, 1000)).toBeNull();

        const outsideBottom: AABB = { x: 100, y: 1100, width: 100, height: 100 };
        expect(clipRectToViewport(outsideBottom, 1000, 1000)).toBeNull();

        const outsideLeft: AABB = { x: -200, y: 100, width: 100, height: 100 };
        expect(clipRectToViewport(outsideLeft, 1000, 1000)).toBeNull();

        const outsideTop: AABB = { x: 100, y: -200, width: 100, height: 100 };
        expect(clipRectToViewport(outsideTop, 1000, 1000)).toBeNull();
      });

      it("clips rects with left/top/right/bottom properties correctly", () => {
        const rect: AABB = {
          x: 900,
          y: 900,
          width: 200,
          height: 200,
          left: 900,
          top: 900,
          right: 1100,
          bottom: 1100,
        };
        const clipped = clipRectToViewport(rect, 1000, 1000);
        expect(clipped).toEqual({
          x: 900,
          y: 900,
          width: 100,
          height: 100,
          left: 900,
          top: 900,
          right: 1000,
          bottom: 1000,
        });
      });
    });

    describe("computeRectanglesUnionArea", () => {
      it("returns 0 for empty rectangle list", () => {
        expect(computeRectanglesUnionArea([])).toBe(0);
      });

      it("returns area for single rectangle", () => {
        expect(computeRectanglesUnionArea([{ x: 10, y: 20, width: 50, height: 40 }])).toBe(2000);
      });

      it("returns 0 when rectangles have zero/negative width or height", () => {
        expect(computeRectanglesUnionArea([{ x: 10, y: 20, width: 0, height: 40 }])).toBe(0);
        expect(computeRectanglesUnionArea([{ x: 10, y: 20, width: -10, height: 40 }])).toBe(0);
      });

      it("returns 0 when all rects have right <= left", () => {
        const invalidRect: AABB = {
          x: 10,
          y: 10,
          width: 0,
          left: 10,
          right: 10,
          top: 10,
          bottom: 20,
          height: 10,
        };
        expect(computeRectanglesUnionArea([invalidRect, invalidRect])).toBe(0);
      });

      it("computes union of non-overlapping rectangles", () => {
        const r1: AABB = {
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          left: 0,
          right: 10,
          top: 0,
          bottom: 10,
        };
        const r2: AABB = {
          x: 20,
          y: 20,
          width: 10,
          height: 10,
          left: 20,
          right: 30,
          top: 20,
          bottom: 30,
        };
        expect(computeRectanglesUnionArea([r1, r2])).toBe(200);
      });

      it("computes union of overlapping rectangles without double counting", () => {
        const r1: AABB = {
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          left: 0,
          right: 10,
          top: 0,
          bottom: 10,
        };
        const r2: AABB = {
          x: 5,
          y: 0,
          width: 10,
          height: 10,
          left: 5,
          right: 15,
          top: 0,
          bottom: 10,
        };
        // Union width 15, height 10 = 150
        expect(computeRectanglesUnionArea([r1, r2])).toBe(150);
      });

      it("handles nested and multiple disjoint slices and vertical interval merges", () => {
        const r1: AABB = {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          left: 0,
          right: 100,
          top: 0,
          bottom: 100,
        };
        const r2: AABB = {
          x: 20,
          y: 20,
          width: 40,
          height: 40,
          left: 20,
          right: 60,
          top: 20,
          bottom: 60,
        };
        const r3: AABB = {
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          left: 50,
          right: 150,
          top: 50,
          bottom: 150,
        };
        const area = computeRectanglesUnionArea([r1, r2, r3]);
        expect(area).toBe(17500); // 100*100 + 100*100 - 50*50 = 10000 + 10000 - 2500 = 17500

        // Disjoint vertical intervals in the exact same x slice
        const rTop: AABB = {
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          left: 0,
          right: 100,
          top: 0,
          bottom: 50,
        };
        const rBottom: AABB = {
          x: 0,
          y: 100,
          width: 100,
          height: 50,
          left: 0,
          right: 100,
          top: 100,
          bottom: 150,
        };
        expect(computeRectanglesUnionArea([rTop, rBottom])).toBe(10000);
      });
    });

    describe("calculateImpactFraction", () => {
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
        expect(
          calculateImpactFraction(
            [
              {
                previousRect: { x: 0, y: 0, width: 10, height: 10 },
                currentRect: { x: 0, y: 0, width: 10, height: 10 },
              },
            ],
            { width: 1000, height: -10 },
          ),
        ).toBe(0);
      });

      it("returns 0 when rects are completely out of viewport", () => {
        const pair = {
          previousRect: { x: 2000, y: 2000, width: 100, height: 100 },
          currentRect: { x: 2100, y: 2000, width: 100, height: 100 },
        };
        expect(calculateImpactFraction([pair], { width: 1000, height: 1000 })).toBe(0);
      });

      it("calculates accurate impact fraction for valid moving rect", () => {
        const pair = {
          previousRect: {
            x: 0,
            y: 0,
            width: 1000,
            height: 200,
            left: 0,
            right: 1000,
            top: 0,
            bottom: 200,
          },
          currentRect: {
            x: 0,
            y: 100,
            width: 1000,
            height: 200,
            left: 0,
            right: 1000,
            top: 100,
            bottom: 300,
          },
        };
        // Union area: 1000 * 300 = 300000 / 1000000 = 0.3
        const impact = calculateImpactFraction([pair], { width: 1000, height: 1000 });
        expect(impact).toBeCloseTo(0.3, 5);
      });
    });

    describe("calculateDistanceFraction", () => {
      it("returns 0 for non-positive viewport or non-positive displacement", () => {
        expect(calculateDistanceFraction(0, { width: 1000, height: 1000 })).toBe(0);
        expect(calculateDistanceFraction(-50, { width: 1000, height: 1000 })).toBe(0);
        expect(calculateDistanceFraction(100, { width: 0, height: 1000 })).toBe(0);
        expect(calculateDistanceFraction(100, { width: 1000, height: 0 })).toBe(0);
      });

      it("calculates fraction against max dimension and clamps to 1", () => {
        expect(calculateDistanceFraction(200, { width: 1000, height: 500 })).toBe(0.2);
        expect(calculateDistanceFraction(1500, { width: 1000, height: 500 })).toBe(1);
      });
    });

    describe("calculateLayoutShiftScore", () => {
      it("multiplies impactFraction and distanceFraction and clamps non-negative", () => {
        expect(calculateLayoutShiftScore(0.5, 0.2)).toBeCloseTo(0.1, 5);
        expect(calculateLayoutShiftScore(Number.NaN, 0.2)).toBe(0);
        expect(calculateLayoutShiftScore(-0.5, 0.2)).toBe(0);
      });
    });
  });

  describe("exclusion", () => {
    describe("identifyRootCausingElements", () => {
      it("returns empty arrays for empty displacements", () => {
        expect(identifyRootCausingElements([])).toEqual({
          rootCauses: [],
          dependentDisplacements: [],
        });
      });

      it("passes excluded items directly into dependentDisplacements", () => {
        const excluded: UnstableElementDisplacement = {
          selector: "#excluded",
          tagName: "div",
          previousRect: { x: 0, y: 0, width: 50, height: 50 },
          currentRect: { x: 0, y: 10, width: 50, height: 50 },
          deltaX: 0,
          deltaY: 10,
          deltaWidth: 0,
          deltaHeight: 0,
          maxDisplacement: 10,
          horizontalDisplacement: 0,
          verticalDisplacement: 10,
          isRootCause: false,
          isExcluded: true,
          exclusionReason: "fixed_or_sticky",
          previousStyles: {} as never,
          currentStyles: {} as never,
        };

        const result = identifyRootCausingElements([excluded]);
        expect(result.dependentDisplacements).toHaveLength(1);
        expect(result.rootCauses).toHaveLength(0);
      });

      it("distinguishes root cause container and dependent nested child with same delta", () => {
        const parent: UnstableElementDisplacement = {
          selector: "#parent-box",
          tagName: "div",
          previousRect: { x: 0, y: 0, width: 500, height: 500 },
          currentRect: { x: 0, y: 100, width: 500, height: 500 },
          deltaX: 0,
          deltaY: 100,
          deltaWidth: 0,
          deltaHeight: 0,
          maxDisplacement: 100,
          horizontalDisplacement: 0,
          verticalDisplacement: 100,
          isRootCause: true,
          isExcluded: false,
          previousStyles: {} as never,
          currentStyles: {} as never,
        };

        const child: UnstableElementDisplacement = {
          selector: "#child-button",
          tagName: "button",
          previousRect: { x: 50, y: 50, width: 100, height: 40 },
          currentRect: { x: 50, y: 150, width: 100, height: 40 },
          deltaX: 0,
          deltaY: 100,
          deltaWidth: 0,
          deltaHeight: 0,
          maxDisplacement: 100,
          horizontalDisplacement: 0,
          verticalDisplacement: 100,
          isRootCause: true,
          isExcluded: false,
          previousStyles: {} as never,
          currentStyles: {} as never,
        };

        const result = identifyRootCausingElements([parent, child]);
        expect(result.rootCauses).toHaveLength(1);
        expect(result.rootCauses[0]?.selector).toBe("#parent-box");
        expect(result.rootCauses[0]?.rootCauseReason).toContain(
          "Element translated vertically by 100px",
        );

        expect(result.dependentDisplacements).toHaveLength(1);
        expect(result.dependentDisplacements[0]?.selector).toBe("#child-button");
        expect(result.dependentDisplacements[0]?.exclusionReason).toBe(
          "nested_child_of_shifting_container",
        );
      });

      it("formats different root cause reasons based on resized vs horizontal vs vertical vs primary", () => {
        const resized: UnstableElementDisplacement = {
          selector: "#resized",
          tagName: "div",
          previousRect: { x: 0, y: 0, width: 100, height: 100 },
          currentRect: { x: 0, y: 0, width: 150, height: 200 },
          deltaX: 0,
          deltaY: 0,
          deltaWidth: 50,
          deltaHeight: 100,
          maxDisplacement: 100,
          horizontalDisplacement: 0,
          verticalDisplacement: 0,
          isRootCause: true,
          isExcluded: false,
          previousStyles: {} as never,
          currentStyles: {} as never,
        };

        const horizontal: UnstableElementDisplacement = {
          selector: "#horizontal",
          tagName: "div",
          previousRect: { x: 0, y: 0, width: 100, height: 100 },
          currentRect: { x: 40, y: 0, width: 100, height: 100 },
          deltaX: 40,
          deltaY: 0,
          deltaWidth: 0,
          deltaHeight: 0,
          maxDisplacement: 40,
          horizontalDisplacement: 40,
          verticalDisplacement: 0,
          isRootCause: true,
          isExcluded: false,
          previousStyles: {} as never,
          currentStyles: {} as never,
        };

        const primary: UnstableElementDisplacement = {
          selector: "#primary",
          tagName: "div",
          previousRect: { x: 500, y: 500, width: 100, height: 100 },
          currentRect: { x: 500, y: 500, width: 102, height: 102 },
          deltaX: 0,
          deltaY: 0,
          deltaWidth: 2,
          deltaHeight: 2,
          maxDisplacement: 2,
          horizontalDisplacement: 0,
          verticalDisplacement: 0,
          isRootCause: true,
          isExcluded: false,
          previousStyles: {} as never,
          currentStyles: {} as never,
        };

        const result = identifyRootCausingElements([resized, horizontal, primary]);
        expect(result.rootCauses[0]?.rootCauseReason).toContain(
          "Element resized (dH: 100px, dW: 50px)",
        );
        expect(result.rootCauses[1]?.rootCauseReason).toContain(
          "Element translated horizontally by 40px",
        );
        expect(result.rootCauses[2]?.rootCauseReason).toBe("Primary shifting element");
      });
    });
  });

  describe("detector", () => {
    it("returns zero score shift entry when viewport is 0x0", () => {
      const snap1 = createMockSnapshot([], { width: 0, height: 0 });
      const snap2 = createMockSnapshot([], { width: 0, height: 0 });
      const entry = detectLayoutShiftBetweenSnapshots(snap1, snap2);
      expect(entry.score).toBe(0);
      expect(entry.isValidShift).toBe(false);
    });

    it("falls back to previous viewport if current snapshot has 0 viewport", () => {
      const el1 = createMockElement("#box", "div", { x: 0, y: 0, width: 100, height: 100 });
      const el2 = createMockElement("#box", "div", { x: 0, y: 50, width: 100, height: 100 });
      const snap1 = createMockSnapshot([el1], { width: 1000, height: 1000 });
      const snap2 = createMockSnapshot([el2], { width: 0, height: 0 });

      const entry = detectLayoutShiftBetweenSnapshots(snap1, snap2);
      expect(entry.score).toBeGreaterThan(0);
      expect(entry.viewport).toEqual({ width: 1000, height: 1000 });
    });

    it("ignores elements missing from previous snapshot or displacement below subpixel tolerance", () => {
      const el1 = createMockElement("#box", "div", { x: 0, y: 0, width: 100, height: 100 });
      const elNew = createMockElement("#new-elem", "div", { x: 0, y: 0, width: 100, height: 100 });
      const elTinyMove = createMockElement("#box", "div", {
        x: 0.1,
        y: 0.1,
        width: 100.1,
        height: 100.1,
      });

      const snap1 = createMockSnapshot([el1]);
      const snap2 = createMockSnapshot([elTinyMove, elNew]);

      const entry = detectLayoutShiftBetweenSnapshots(snap1, snap2);
      expect(entry.sources).toHaveLength(0);
      expect(entry.score).toBe(0);

      // Width expanded with 0 translation
      const elWidthChanged = createMockElement("#box", "div", {
        x: 0,
        y: 0,
        width: 150,
        height: 100,
      });
      const entryWidth = detectLayoutShiftBetweenSnapshots(
        snap1,
        createMockSnapshot([elWidthChanged]),
      );
      expect(entryWidth.sources).toHaveLength(1);

      // Height expanded with 0 translation
      const elHeightChanged = createMockElement("#box", "div", {
        x: 0,
        y: 0,
        width: 100,
        height: 150,
      });
      const entryHeight = detectLayoutShiftBetweenSnapshots(
        snap1,
        createMockSnapshot([elHeightChanged]),
      );
      expect(entryHeight.sources).toHaveLength(1);
    });

    it("marks fixed/sticky elements as excluded", () => {
      const el1 = createMockElement(
        "#sticky-header",
        "header",
        { x: 0, y: 0, width: 1000, height: 50 },
        { position: "sticky" },
      );
      const el2 = createMockElement(
        "#sticky-header",
        "header",
        { x: 0, y: 100, width: 1000, height: 50 },
        { position: "sticky" },
      );

      const entry = detectLayoutShiftBetweenSnapshots(
        createMockSnapshot([el1]),
        createMockSnapshot([el2]),
      );
      expect(entry.sources).toHaveLength(1);
      expect(entry.sources[0]?.isExcluded).toBe(true);
      expect(entry.sources[0]?.exclusionReason).toBe("fixed_or_sticky");
      expect(entry.score).toBe(0);
    });

    it("marks off-screen out of bounds elements as excluded", () => {
      const el1 = createMockElement("#offscreen", "div", {
        x: 3000,
        y: 3000,
        width: 100,
        height: 100,
      });
      const el2 = createMockElement("#offscreen", "div", {
        x: 3000,
        y: 3100,
        width: 100,
        height: 100,
      });

      const entry = detectLayoutShiftBetweenSnapshots(
        createMockSnapshot([el1]),
        createMockSnapshot([el2]),
      );
      expect(entry.sources).toHaveLength(1);
      expect(entry.sources[0]?.isExcluded).toBe(true);
      expect(entry.sources[0]?.exclusionReason).toBe("out_of_bounds");
    });

    it("marks shifts during user input as excluded when ignoreUserInputShifts is true", () => {
      const el1 = createMockElement("#content", "div", { x: 0, y: 0, width: 500, height: 200 });
      const el2 = createMockElement("#content", "div", { x: 0, y: 200, width: 500, height: 200 });

      const entry = detectLayoutShiftBetweenSnapshots(
        createMockSnapshot([el1]),
        createMockSnapshot([el2]),
        {
          hadRecentInput: true,
          ignoreUserInputShifts: true,
        },
      );

      expect(entry.sources).toHaveLength(1);
      expect(entry.sources[0]?.isExcluded).toBe(true);
      expect(entry.sources[0]?.exclusionReason).toBe("user_input_recent");
      expect(entry.isValidShift).toBe(false);
    });
  });

  describe("session-windows", () => {
    describe("groupSessionWindows", () => {
      it("returns empty array for empty entries", () => {
        expect(groupSessionWindows([])).toEqual([]);
      });

      it("groups shifts within gap and duration thresholds into single session window", () => {
        const e1 = createSampleShiftEntry("s1", 1000, 0.05);
        const e2 = createSampleShiftEntry("s2", 1500, 0.05);
        const e3 = createSampleShiftEntry("s3", 2000, 0.05);

        const windows = groupSessionWindows([e1, e2, e3], {
          sessionMaxGapMs: 1000,
          sessionMaxDurationMs: 5000,
        });
        expect(windows).toHaveLength(1);
        expect(windows[0]?.windowScore).toBeCloseTo(0.15, 5);
        expect(windows[0]?.isMaxWindow).toBe(true);
      });

      it("splits session windows when gap exceeds maxGap", () => {
        const e1 = createSampleShiftEntry("s1", 1000, 0.05);
        const e2 = createSampleShiftEntry("s2", 3000, 0.08); // gap is 2000ms > 1000ms

        const windows = groupSessionWindows([e1, e2], {
          sessionMaxGapMs: 1000,
          sessionMaxDurationMs: 5000,
        });
        expect(windows).toHaveLength(2);
        expect(windows[0]?.windowScore).toBeCloseTo(0.05, 5);
        expect(windows[0]?.isMaxWindow).toBe(false);
        expect(windows[1]?.windowScore).toBeCloseTo(0.08, 5);
        expect(windows[1]?.isMaxWindow).toBe(true);
      });

      it("splits session windows when total duration exceeds maxDuration", () => {
        const e1 = createSampleShiftEntry("s1", 1000, 0.05);
        const e2 = createSampleShiftEntry("s2", 1800, 0.05);
        const e3 = createSampleShiftEntry("s3", 2600, 0.05);
        const e4 = createSampleShiftEntry("s4", 3400, 0.05);
        // Total duration from 1000 to 3400 is 2400 > maxDuration 2000

        const windows = groupSessionWindows([e1, e2, e3, e4], {
          sessionMaxGapMs: 1000,
          sessionMaxDurationMs: 2000,
        });
        expect(windows.length).toBeGreaterThan(1);
      });
    });

    describe("buildCumulativeLayoutShiftReport", () => {
      it("reports 'good' rating when clsScore <= 0.1", () => {
        const e1 = createSampleShiftEntry("s1", 1000, 0.05);
        const report = buildCumulativeLayoutShiftReport([e1]);
        expect(report.clsScore).toBeCloseTo(0.05, 5);
        expect(report.rating).toBe("good");
        expect(report.summary).toContain("Good");
      });

      it("reports 'needs-improvement' rating when clsScore is between 0.1 and 0.25", () => {
        const e1 = createSampleShiftEntry("s1", 1000, 0.15);
        const report = buildCumulativeLayoutShiftReport([e1]);
        expect(report.clsScore).toBeCloseTo(0.15, 5);
        expect(report.rating).toBe("needs-improvement");
        expect(report.summary).toContain("Needs Improvement");
      });

      it("reports 'poor' rating when clsScore > 0.25 and deduplicates root causes", () => {
        const rc1: UnstableElementDisplacement = {
          selector: "#bad-ad-banner",
          tagName: "div",
          previousRect: { x: 0, y: 0, width: 100, height: 100 },
          currentRect: { x: 0, y: 200, width: 100, height: 100 },
          deltaX: 0,
          deltaY: 200,
          deltaWidth: 0,
          deltaHeight: 0,
          maxDisplacement: 200,
          horizontalDisplacement: 0,
          verticalDisplacement: 200,
          isRootCause: true,
          isExcluded: false,
          previousStyles: {} as never,
          currentStyles: {} as never,
        };

        const e1 = createSampleShiftEntry("s1", 1000, 0.3, true, [rc1]);
        const e2 = createSampleShiftEntry("s2", 1500, 0.1, true, [rc1]); // Duplicate root cause selector

        const report = buildCumulativeLayoutShiftReport([e1, e2]);
        expect(report.rating).toBe("poor");
        expect(report.summary).toContain("Poor");
        expect(report.rootCauseElements).toHaveLength(1);
      });
    });
  });

  describe("LayoutShiftTracker stateful runner", () => {
    it("tracks snapshots diffs, user input windows, and resets properly", () => {
      const tracker = new LayoutShiftTracker({ userInputWindowMs: 500 });
      expect(tracker.getEntries()).toHaveLength(0);

      const el1 = createMockElement("#hero", "div", { x: 0, y: 0, width: 500, height: 200 });
      const el2 = createMockElement("#hero", "div", { x: 0, y: 150, width: 500, height: 200 });

      const snap1 = createMockSnapshot([el1]);
      const snap2 = createMockSnapshot([el2]);

      const entry1 = tracker.trackSnapshotDiff(snap1, snap2, 1000);
      expect(entry1.score).toBeGreaterThan(0);
      expect(tracker.getEntries()).toHaveLength(1);

      // Record direct shift entry
      const direct = createSampleShiftEntry("direct", 2000, 0.02);
      tracker.recordShiftEntry(direct);
      expect(tracker.getEntries()).toHaveLength(2);

      // User input tracking
      tracker.recordUserInput(5000);
      expect(tracker.hadRecentInput(5200)).toBe(true);
      expect(tracker.hadRecentInput(6000)).toBe(false);

      // Generate report
      const report = tracker.generateReport();
      expect(report.totalEntries).toBe(2);

      // Reset
      tracker.reset();
      expect(tracker.getEntries()).toHaveLength(0);
      expect(tracker.hadRecentInput(5200)).toBe(false);
    });
  });
});
