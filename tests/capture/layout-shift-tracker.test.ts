import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCumulativeLayoutShiftReport,
  calculateDistanceFraction,
  calculateImpactFraction,
  calculateLayoutShiftScore,
  clipRectToViewport,
  computeRectanglesUnionArea,
  detectLayoutShiftBetweenSnapshots,
  groupSessionWindows,
  identifyRootCausingElements,
  LayoutShiftTracker,
  type LayoutShiftEntry,
  type UnstableElementDisplacement,
} from "../../../olt/scripts/src/capture/runners/index.ts";
import type {
  AABB,
  DomPhysicsSnapshot,
  ExtractedElementPhysics,
} from "../../../olt/scripts/src/capture/runners/types.ts";

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
      display: typeof styles.display === "string" ? styles.display : "block",
      position: typeof styles.position === "string" ? styles.position : "static",
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
): LayoutShiftEntry {
  return {
    id,
    timestamp,
    impactFraction: score > 0 ? 0.5 : 0,
    distanceFraction: score > 0 ? score / 0.5 : 0,
    score,
    hadRecentInput: false,
    sources: [],
    rootCauses: [],
    viewport: { width: 1000, height: 1000 },
    isValidShift,
  };
}

describe("Cumulative Layout Shift (CLS) Tracking & Event Simulation", () => {
  describe("Geometric Primitives & Single Shift Calculation", () => {
    it("clipRectToViewport clips rectangles correctly against viewport boundaries", () => {
      const inside: AABB = {
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        left: 100,
        right: 300,
        top: 100,
        bottom: 300,
      };
      const clippedInside = clipRectToViewport(inside, 1000, 1000);
      expect(clippedInside).not.toBeNull();
      expect(clippedInside?.x).toBe(100);
      expect(clippedInside?.y).toBe(100);
      expect(clippedInside?.width).toBe(200);
      expect(clippedInside?.height).toBe(200);

      const overflowRightBottom: AABB = {
        x: 800,
        y: 900,
        width: 400,
        height: 300,
        left: 800,
        right: 1200,
        top: 900,
        bottom: 1200,
      };
      const clippedOverflow = clipRectToViewport(overflowRightBottom, 1000, 1000);
      expect(clippedOverflow).not.toBeNull();
      expect(clippedOverflow?.x).toBe(800);
      expect(clippedOverflow?.y).toBe(900);
      expect(clippedOverflow?.width).toBe(200);
      expect(clippedOverflow?.height).toBe(100);

      const negativeTopLeft: AABB = {
        x: -50,
        y: -100,
        width: 150,
        height: 200,
        left: -50,
        right: 100,
        top: -100,
        bottom: 100,
      };
      const clippedNegative = clipRectToViewport(negativeTopLeft, 1000, 1000);
      expect(clippedNegative).not.toBeNull();
      expect(clippedNegative?.x).toBe(0);
      expect(clippedNegative?.y).toBe(0);
      expect(clippedNegative?.width).toBe(100);
      expect(clippedNegative?.height).toBe(100);

      const completelyOutside: AABB = {
        x: 1200,
        y: 1200,
        width: 200,
        height: 200,
        left: 1200,
        right: 1400,
        top: 1200,
        bottom: 1400,
      };
      expect(clipRectToViewport(completelyOutside, 1000, 1000)).toBeNull();

      expect(clipRectToViewport(inside, 0, 0)).toBeNull();
      expect(clipRectToViewport(inside, -100, 500)).toBeNull();
    });

    it("computeRectanglesUnionArea computes exact 2D sweep-line union area", () => {
      expect(computeRectanglesUnionArea([])).toBe(0);

      const single: AABB = {
        x: 10,
        y: 10,
        width: 100,
        height: 50,
        left: 10,
        right: 110,
        top: 10,
        bottom: 60,
      };
      expect(computeRectanglesUnionArea([single])).toBe(5000);

      const disjointA: AABB = {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        left: 0,
        right: 100,
        top: 0,
        bottom: 100,
      };
      const disjointB: AABB = {
        x: 200,
        y: 200,
        width: 100,
        height: 100,
        left: 200,
        right: 300,
        top: 200,
        bottom: 300,
      };
      expect(computeRectanglesUnionArea([disjointA, disjointB])).toBe(20000);

      const overlapA: AABB = {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        left: 0,
        right: 100,
        top: 0,
        bottom: 100,
      };
      const overlapB: AABB = {
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        left: 50,
        right: 150,
        top: 50,
        bottom: 150,
      };
      expect(computeRectanglesUnionArea([overlapA, overlapB])).toBe(17500);

      const duplicateA: AABB = {
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        left: 0,
        right: 80,
        top: 0,
        bottom: 80,
      };
      const duplicateB: AABB = {
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        left: 0,
        right: 80,
        top: 0,
        bottom: 80,
      };
      expect(computeRectanglesUnionArea([duplicateA, duplicateB])).toBe(6400);
    });

    it("calculateImpactFraction computes viewport-normalized impact area", () => {
      const viewport = { width: 1000, height: 1000 };

      expect(calculateImpactFraction([], viewport)).toBe(0);
      expect(
        calculateImpactFraction(
          [
            {
              previousRect: {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                left: 0,
                right: 100,
                top: 0,
                bottom: 100,
              },
              currentRect: {
                x: 0,
                y: 50,
                width: 100,
                height: 100,
                left: 0,
                right: 100,
                top: 50,
                bottom: 150,
              },
            },
          ],
          { width: 0, height: 0 },
        ),
      ).toBe(0);

      const singleShift = [
        {
          previousRect: {
            x: 0,
            y: 0,
            width: 500,
            height: 500,
            left: 0,
            right: 500,
            top: 0,
            bottom: 500,
          },
          currentRect: {
            x: 0,
            y: 200,
            width: 500,
            height: 500,
            left: 0,
            right: 500,
            top: 200,
            bottom: 700,
          },
        },
      ];
      const impactFraction = calculateImpactFraction(singleShift, viewport);
      expect(impactFraction).toBeCloseTo(0.35, 4);
    });

    it("calculateDistanceFraction computes normalized maximum displacement", () => {
      const viewport = { width: 1000, height: 800 };

      expect(calculateDistanceFraction(0, viewport)).toBe(0);
      expect(calculateDistanceFraction(-50, viewport)).toBe(0);
      expect(calculateDistanceFraction(100, { width: 0, height: 0 })).toBe(0);

      const distanceFraction = calculateDistanceFraction(200, viewport);
      expect(distanceFraction).toBe(0.2);

      const cappedFraction = calculateDistanceFraction(1500, viewport);
      expect(cappedFraction).toBe(1.0);
    });

    it("calculateLayoutShiftScore multiplies impact fraction and distance fraction", () => {
      const score = calculateLayoutShiftScore(0.35, 0.2);
      expect(score).toBeCloseTo(0.07, 4);

      expect(calculateLayoutShiftScore(0, 0.5)).toBe(0);
      expect(calculateLayoutShiftScore(0.5, 0)).toBe(0);
      expect(calculateLayoutShiftScore(Number.NaN, 0.5)).toBe(0);
    });

    it("enforces sub-pixel shift thresholds", () => {
      const elPrev = createMockElement("div.box", "DIV", {
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      });
      const elCurrSubpixel = createMockElement("div.box", "DIV", {
        x: 100.3,
        y: 100.2,
        width: 200,
        height: 200,
      });
      const snapPrev = createMockSnapshot([elPrev]);
      const snapSubpixel = createMockSnapshot([elCurrSubpixel]);

      const subpixelShift = detectLayoutShiftBetweenSnapshots(snapPrev, snapSubpixel, {
        subpixelTolerance: 0.5,
      });

      expect(subpixelShift.score).toBe(0);
      expect(subpixelShift.sources.length).toBe(0);
      expect(subpixelShift.isValidShift).toBe(false);

      const elCurrSignificant = createMockElement("div.box", "DIV", {
        x: 100,
        y: 120,
        width: 200,
        height: 200,
      });
      const snapSignificant = createMockSnapshot([elCurrSignificant]);

      const significantShift = detectLayoutShiftBetweenSnapshots(snapPrev, snapSignificant, {
        subpixelTolerance: 0.5,
      });

      expect(significantShift.score).toBeGreaterThan(0);
      expect(significantShift.sources.length).toBe(1);
      expect(significantShift.sources[0]?.deltaY).toBe(20);
      expect(significantShift.isValidShift).toBe(true);
    });
  });

  describe("Web Vitals Session Windowing", () => {
    it("groups isolated shifts into single session windows", () => {
      const entry = createSampleShiftEntry("shift-1", 1000, 0.05);
      const windows = groupSessionWindows([entry]);

      expect(windows.length).toBe(1);
      expect(windows[0]?.windowIndex).toBe(0);
      expect(windows[0]?.startTime).toBe(1000);
      expect(windows[0]?.endTime).toBe(1000);
      expect(windows[0]?.duration).toBe(0);
      expect(windows[0]?.windowScore).toBeCloseTo(0.05, 4);
      expect(windows[0]?.isMaxWindow).toBe(true);
    });

    it("clusters consecutive shifts within 1000ms into a single session window", () => {
      const entries: LayoutShiftEntry[] = [
        createSampleShiftEntry("s1", 1000, 0.04),
        createSampleShiftEntry("s2", 1500, 0.03),
        createSampleShiftEntry("s3", 2200, 0.05),
      ];

      const windows = groupSessionWindows(entries, {
        sessionMaxGapMs: 1000,
        sessionMaxDurationMs: 5000,
      });

      expect(windows.length).toBe(1);
      expect(windows[0]?.entries.length).toBe(3);
      expect(windows[0]?.startTime).toBe(1000);
      expect(windows[0]?.endTime).toBe(2200);
      expect(windows[0]?.duration).toBe(1200);
      expect(windows[0]?.windowScore).toBeCloseTo(0.12, 4);
      expect(windows[0]?.isMaxWindow).toBe(true);
    });

    it("splits session windows when the gap between shifts exceeds 1000ms", () => {
      const entries: LayoutShiftEntry[] = [
        createSampleShiftEntry("s1", 1000, 0.04),
        createSampleShiftEntry("s2", 1400, 0.03),
        createSampleShiftEntry("s3", 2600, 0.08),
        createSampleShiftEntry("s4", 3000, 0.02),
      ];

      const windows = groupSessionWindows(entries, {
        sessionMaxGapMs: 1000,
        sessionMaxDurationMs: 5000,
      });

      expect(windows.length).toBe(2);
      expect(windows[0]?.entries.length).toBe(2);
      expect(windows[0]?.windowScore).toBeCloseTo(0.07, 4);
      expect(windows[0]?.isMaxWindow).toBe(false);

      expect(windows[1]?.entries.length).toBe(2);
      expect(windows[1]?.windowScore).toBeCloseTo(0.1, 4);
      expect(windows[1]?.isMaxWindow).toBe(true);
    });

    it("caps session windows at maximum 5000ms duration even with small gaps", () => {
      const entries: LayoutShiftEntry[] = [
        createSampleShiftEntry("s0", 0, 0.02),
        createSampleShiftEntry("s1", 800, 0.02),
        createSampleShiftEntry("s2", 1600, 0.02),
        createSampleShiftEntry("s3", 2400, 0.02),
        createSampleShiftEntry("s4", 3200, 0.02),
        createSampleShiftEntry("s5", 4000, 0.02),
        createSampleShiftEntry("s6", 4800, 0.02),
        createSampleShiftEntry("s7", 5600, 0.05),
      ];

      const windows = groupSessionWindows(entries, {
        sessionMaxGapMs: 1000,
        sessionMaxDurationMs: 5000,
      });

      expect(windows.length).toBe(2);
      expect(windows[0]?.entries.length).toBe(7);
      expect(windows[0]?.startTime).toBe(0);
      expect(windows[0]?.endTime).toBe(4800);
      expect(windows[0]?.duration).toBe(4800);
      expect(windows[0]?.windowScore).toBeCloseTo(0.14, 4);

      expect(windows[1]?.entries.length).toBe(1);
      expect(windows[1]?.startTime).toBe(5600);
      expect(windows[1]?.windowScore).toBeCloseTo(0.05, 4);

      expect(windows[0]?.isMaxWindow).toBe(true);
      expect(windows[1]?.isMaxWindow).toBe(false);
    });

    it("buildCumulativeLayoutShiftReport selects max session window score and computes proper rating", () => {
      const goodEntries = [
        createSampleShiftEntry("s1", 1000, 0.03),
        createSampleShiftEntry("s2", 1400, 0.04),
      ];
      const goodReport = buildCumulativeLayoutShiftReport(goodEntries);
      expect(goodReport.clsScore).toBeCloseTo(0.07, 4);
      expect(goodReport.rating).toBe("good");
      expect(goodReport.summary).toContain("Good");

      const needsImprovementEntries = [
        createSampleShiftEntry("s1", 1000, 0.08),
        createSampleShiftEntry("s2", 1500, 0.09),
      ];
      const niReport = buildCumulativeLayoutShiftReport(needsImprovementEntries);
      expect(niReport.clsScore).toBeCloseTo(0.17, 4);
      expect(niReport.rating).toBe("needs-improvement");
      expect(niReport.summary).toContain("Needs Improvement");

      const poorEntries = [
        createSampleShiftEntry("s1", 1000, 0.18),
        createSampleShiftEntry("s2", 1400, 0.15),
      ];
      const poorReport = buildCumulativeLayoutShiftReport(poorEntries);
      expect(poorReport.clsScore).toBeCloseTo(0.33, 4);
      expect(poorReport.rating).toBe("poor");
      expect(poorReport.summary).toContain("Poor");

      const emptyReport = buildCumulativeLayoutShiftReport([]);
      expect(emptyReport.clsScore).toBe(0);
      expect(emptyReport.sessionWindows.length).toBe(0);
      expect(emptyReport.maxSessionWindow).toBeNull();
      expect(emptyReport.rating).toBe("good");
    });
  });

  describe("Unstable Element Displacement Tracking", () => {
    it("measures coordinate deltas, dimension deltas, and displacement vectors", () => {
      const prevEl = createMockElement("div.hero", "DIV", {
        x: 100,
        y: 150,
        width: 400,
        height: 250,
      });
      const currEl = createMockElement("div.hero", "DIV", {
        x: 130,
        y: 220,
        width: 450,
        height: 230,
      });

      const snapPrev = createMockSnapshot([prevEl]);
      const snapCurr = createMockSnapshot([currEl]);

      const shift = detectLayoutShiftBetweenSnapshots(snapPrev, snapCurr);
      expect(shift.sources.length).toBe(1);

      const d = shift.sources[0]!;
      expect(d.selector).toBe("div.hero");
      expect(d.deltaX).toBe(30);
      expect(d.deltaY).toBe(70);
      expect(d.deltaWidth).toBe(50);
      expect(d.deltaHeight).toBe(-20);
      expect(d.horizontalDisplacement).toBe(30);
      expect(d.verticalDisplacement).toBe(70);
      expect(d.maxDisplacement).toBe(70);
      expect(d.previousRect.x).toBe(100);
      expect(d.currentRect.x).toBe(130);
    });

    it("disambiguates root causes from nested child elements", () => {
      const containerPrev = createMockElement("div.card", "DIV", {
        x: 50,
        y: 100,
        width: 300,
        height: 200,
      });
      const childButtonPrev = createMockElement("button.cta", "BUTTON", {
        x: 70,
        y: 150,
        width: 100,
        height: 40,
      });

      const containerCurr = createMockElement("div.card", "DIV", {
        x: 50,
        y: 180,
        width: 300,
        height: 200,
      });
      const childButtonCurr = createMockElement("button.cta", "BUTTON", {
        x: 70,
        y: 230,
        width: 100,
        height: 40,
      });

      const snapPrev = createMockSnapshot([containerPrev, childButtonPrev]);
      const snapCurr = createMockSnapshot([containerCurr, childButtonCurr]);

      const shift = detectLayoutShiftBetweenSnapshots(snapPrev, snapCurr);

      expect(shift.rootCauses.length).toBe(1);
      expect(shift.rootCauses[0]?.selector).toBe("div.card");
      expect(shift.rootCauses[0]?.isRootCause).toBe(true);

      const dependentChild = shift.sources.find((s) => s.selector === "button.cta");
      expect(dependentChild).toBeDefined();
      expect(dependentChild?.isRootCause).toBe(false);
      expect(dependentChild?.exclusionReason).toBe("nested_child_of_shifting_container");
    });

    it("identifies reflowing elements that resize as root causes", () => {
      const rawDisplacements: UnstableElementDisplacement[] = [
        {
          selector: "div.banner",
          tagName: "DIV",
          previousRect: {
            x: 0,
            y: 0,
            width: 1000,
            height: 50,
            left: 0,
            right: 1000,
            top: 0,
            bottom: 50,
          },
          currentRect: {
            x: 0,
            y: 0,
            width: 1000,
            height: 200,
            left: 0,
            right: 1000,
            top: 0,
            bottom: 200,
          },
          deltaX: 0,
          deltaY: 0,
          deltaWidth: 0,
          deltaHeight: 150,
          maxDisplacement: 0,
          horizontalDisplacement: 0,
          verticalDisplacement: 0,
          isRootCause: true,
          isExcluded: false,
        },
      ];

      const { rootCauses } = identifyRootCausingElements(rawDisplacements);
      expect(rootCauses.length).toBe(1);
      expect(rootCauses[0]?.rootCauseReason).toContain("Element resized");
      expect(rootCauses[0]?.rootCauseReason).toContain("dH: 150px");
    });

    it("excludes fixed and sticky elements when option is enabled", () => {
      const fixedPrev = createMockElement(
        "header.navbar",
        "HEADER",
        {
          x: 0,
          y: 0,
          width: 1000,
          height: 60,
        },
        { position: "fixed" },
      );
      const fixedCurr = createMockElement(
        "header.navbar",
        "HEADER",
        {
          x: 0,
          y: 10,
          width: 1000,
          height: 60,
        },
        { position: "fixed" },
      );

      const snapPrev = createMockSnapshot([fixedPrev]);
      const snapCurr = createMockSnapshot([fixedCurr]);

      const shift = detectLayoutShiftBetweenSnapshots(snapPrev, snapCurr, {
        excludeFixedSticky: true,
      });

      const fixedSource = shift.sources.find((s) => s.selector === "header.navbar");
      expect(fixedSource).toBeDefined();
      expect(fixedSource?.isExcluded).toBe(true);
      expect(fixedSource?.exclusionReason).toBe("fixed_or_sticky");
      expect(shift.score).toBe(0);
    });

    it("excludes completely out of bounds elements", () => {
      const offscreenPrev = createMockElement("div.offscreen", "DIV", {
        x: 2000,
        y: 2000,
        width: 200,
        height: 200,
      });
      const offscreenCurr = createMockElement("div.offscreen", "DIV", {
        x: 2000,
        y: 2100,
        width: 200,
        height: 200,
      });

      const snapPrev = createMockSnapshot([offscreenPrev]);
      const snapCurr = createMockSnapshot([offscreenCurr]);

      const shift = detectLayoutShiftBetweenSnapshots(snapPrev, snapCurr);
      const source = shift.sources.find((s) => s.selector === "div.offscreen");
      expect(source).toBeDefined();
      expect(source?.isExcluded).toBe(true);
      expect(source?.exclusionReason).toBe("out_of_bounds");
      expect(shift.score).toBe(0);
    });
  });

  describe("DOM Event Simulation Triggering Shifts", () => {
    it("simulates hovering dropdown menu causing header and content displacement", () => {
      const dropdownPrev = createMockElement("div.dropdown-menu", "DIV", {
        x: 200,
        y: 20,
        width: 150,
        height: 40,
      });
      const contentPrev = createMockElement("main.content", "MAIN", {
        x: 50,
        y: 80,
        width: 900,
        height: 500,
      });

      const dropdownCurrHovered = createMockElement("div.dropdown-menu", "DIV", {
        x: 200,
        y: 20,
        width: 150,
        height: 240,
      });
      const contentCurrPushed = createMockElement("main.content", "MAIN", {
        x: 50,
        y: 280,
        width: 900,
        height: 500,
      });

      const snapBeforeHover = createMockSnapshot([dropdownPrev, contentPrev]);
      const snapAfterHover = createMockSnapshot([dropdownCurrHovered, contentCurrPushed]);

      const shift = detectLayoutShiftBetweenSnapshots(snapBeforeHover, snapAfterHover);

      expect(shift.score).toBeGreaterThan(0);
      expect(shift.sources.length).toBe(2);

      const dropdownDisplacement = shift.sources.find((s) => s.selector === "div.dropdown-menu")!;
      expect(dropdownDisplacement.deltaHeight).toBe(200);

      const contentDisplacement = shift.sources.find((s) => s.selector === "main.content")!;
      expect(contentDisplacement.deltaY).toBe(200);
      expect(contentDisplacement.verticalDisplacement).toBe(200);
    });

    it("simulates clicking accordion item pushing downstream FAQ items", () => {
      const accordionHeader = createMockElement("div.accordion-item-1", "DIV", {
        x: 100,
        y: 100,
        width: 800,
        height: 50,
      });
      const downstreamItem = createMockElement("div.accordion-item-2", "DIV", {
        x: 100,
        y: 160,
        width: 800,
        height: 50,
      });
      const footer = createMockElement("footer.page-footer", "FOOTER", {
        x: 100,
        y: 220,
        width: 800,
        height: 100,
      });

      const accordionExpanded = createMockElement("div.accordion-item-1", "DIV", {
        x: 100,
        y: 100,
        width: 800,
        height: 250,
      });
      const downstreamPushed = createMockElement("div.accordion-item-2", "DIV", {
        x: 100,
        y: 360,
        width: 800,
        height: 50,
      });
      const footerPushed = createMockElement("footer.page-footer", "FOOTER", {
        x: 100,
        y: 420,
        width: 800,
        height: 100,
      });

      const snapCollapsed = createMockSnapshot([accordionHeader, downstreamItem, footer]);
      const snapExpanded = createMockSnapshot([accordionExpanded, downstreamPushed, footerPushed]);

      const shift = detectLayoutShiftBetweenSnapshots(snapCollapsed, snapExpanded);

      expect(shift.score).toBeGreaterThan(0.05);
      expect(shift.rootCauses.length).toBeGreaterThanOrEqual(1);

      const item2 = shift.sources.find((s) => s.selector === "div.accordion-item-2");
      expect(item2?.deltaY).toBe(200);

      const footerSource = shift.sources.find((s) => s.selector === "footer.page-footer");
      expect(footerSource?.deltaY).toBe(200);
    });

    it("simulates async content injection (top banner insertion) with high CLS impact", () => {
      const bannerInjected = createMockElement("div.async-banner", "DIV", {
        x: 0,
        y: 0,
        width: 1000,
        height: 180,
      });
      const mainHeaderPrev = createMockElement("h1.title", "H1", {
        x: 50,
        y: 20,
        width: 600,
        height: 60,
      });
      const mainArticlePrev = createMockElement("article.story", "ARTICLE", {
        x: 50,
        y: 100,
        width: 900,
        height: 600,
      });

      const mainHeaderShifted = createMockElement("h1.title", "H1", {
        x: 50,
        y: 200,
        width: 600,
        height: 60,
      });
      const mainArticleShifted = createMockElement("article.story", "ARTICLE", {
        x: 50,
        y: 280,
        width: 900,
        height: 600,
      });

      const snapBefore = createMockSnapshot([mainHeaderPrev, mainArticlePrev]);
      const snapAfter = createMockSnapshot([bannerInjected, mainHeaderShifted, mainArticleShifted]);

      const shift = detectLayoutShiftBetweenSnapshots(snapBefore, snapAfter);

      expect(shift.score).toBeGreaterThan(0.1);
      expect(shift.sources.length).toBe(2);

      const report = buildCumulativeLayoutShiftReport([shift]);
      expect(report.clsScore).toBeGreaterThan(0.1);
      expect(["needs-improvement", "poor"]).toContain(report.rating);
    });

    it("distinguishes expected user-initiated shifts from unexpected async shifts via input window", () => {
      const tracker = new LayoutShiftTracker({
        userInputWindowMs: 500,
        ignoreUserInputShifts: true,
      });

      const elA = createMockElement("div.feed", "DIV", { x: 50, y: 50, width: 500, height: 400 });
      const elB = createMockElement("div.feed", "DIV", { x: 50, y: 150, width: 500, height: 400 });
      const snapA = createMockSnapshot([elA]);
      const snapB = createMockSnapshot([elB]);

      // User interacts at t=1000
      tracker.recordUserInput(1000);

      // Shift occurs at t=1200 (200ms after user input <= 500ms window)
      const userInitiatedShift = tracker.trackSnapshotDiff(snapA, snapB, 1200);
      expect(userInitiatedShift.hadRecentInput).toBe(true);
      expect(userInitiatedShift.isValidShift).toBe(false);

      // Async layout shift occurs at t=2000 (1000ms after input > 500ms window)
      const unexpectedAsyncShift = tracker.trackSnapshotDiff(snapA, snapB, 2000);
      expect(unexpectedAsyncShift.hadRecentInput).toBe(false);
      expect(unexpectedAsyncShift.isValidShift).toBe(true);
      expect(unexpectedAsyncShift.score).toBeGreaterThan(0);

      const report = tracker.generateReport();
      expect(report.totalEntries).toBe(2);
      expect(report.clsScore).toBe(unexpectedAsyncShift.score);
    });

    it("manages lifecycle and state correctly in LayoutShiftTracker", () => {
      const tracker = new LayoutShiftTracker();

      expect(tracker.getEntries().length).toBe(0);
      expect(tracker.hadRecentInput()).toBe(false);

      const now = Date.now();
      tracker.recordUserInput(now);
      expect(tracker.hadRecentInput(now + 100)).toBe(true);
      expect(tracker.hadRecentInput(now + 600)).toBe(false);

      const shift1 = createSampleShiftEntry("s1", now + 700, 0.05);
      tracker.recordShiftEntry(shift1);
      expect(tracker.getEntries().length).toBe(1);

      const report = tracker.generateReport();
      expect(report.clsScore).toBeCloseTo(0.05, 4);

      tracker.reset();
      expect(tracker.getEntries().length).toBe(0);
      expect(tracker.hadRecentInput(now + 100)).toBe(false);
    });
  });

  describe("Static Invariant Verification", () => {
    it("ensures zero TypeScript any annotations and zero suppressions across files", () => {
      const targetFiles = [
        resolve(
          __dirname,
          "../../../olt/scripts/src/capture/runners/layout-shift-tracker/index.ts",
        ),
        resolve(__dirname, "layout-shift-tracker.test.ts"),
      ];

      const dash = "-";
      const space = " ";
      const forbiddenSuppressions = [
        `@ts${dash}ignore`,
        `@ts${dash}expect${dash}error`,
        `@ts${dash}nocheck`,
        `eslint${dash}disable`,
        `oxlint${dash}disable`,
        `v8${space}ignore`,
        `istanbul${space}ignore`,
      ];

      const prohibitedAnyRegex = new RegExp(
        [":\\s*any\\b", "<any>", "as\\s+any\\b", "=\\s*any\\b", ",\\s*any\\b", "\\bany\\[\\]"].join(
          "|",
        ),
      );

      for (const filePath of targetFiles) {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx]!;

          // If inspecting the test file itself, skip the static verification test block
          if (filePath.endsWith(".test.ts") && line.includes("Static Invariant Verification")) {
            break;
          }

          // Check for suppressions
          for (const suppression of forbiddenSuppressions) {
            expect(line.includes(suppression)).toBe(false);
          }

          // Strict check for prohibited 'any' keywords
          expect(prohibitedAnyRegex.test(line)).toBe(false);
        }
      }
    });
  });
});
