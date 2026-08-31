import { describe, expect, it } from "bun:test";
import {
  buildCumulativeLayoutShiftReport,
  groupSessionWindows,
  LayoutShiftTracker,
  type LayoutShiftEntry,
  type UnstableElementDisplacement,
} from "../../../olt/scripts/src/capture/runners/index.ts";
import type {
  DomPhysicsSnapshot,
  ExtractedElementPhysics,
} from "../../../olt/scripts/src/capture/runners/types.ts";

function createMockElement(
  selector: string,
  tagName: string,
  bounds: { x: number; y: number; width: number; height: number },
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
      display: "block",
      position: "static",
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

describe("layout-shift-tracker: session windows, scoring, and lifecycle", () => {
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
      const e2 = createSampleShiftEntry("s2", 3000, 0.08);

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
      const e2 = createSampleShiftEntry("s2", 1500, 0.1, true, [rc1]);

      const report = buildCumulativeLayoutShiftReport([e1, e2]);
      expect(report.rating).toBe("poor");
      expect(report.summary).toContain("Poor");
      expect(report.rootCauseElements).toHaveLength(1);
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

      const direct = createSampleShiftEntry("direct", 2000, 0.02);
      tracker.recordShiftEntry(direct);
      expect(tracker.getEntries()).toHaveLength(2);

      tracker.recordUserInput(5000);
      expect(tracker.hadRecentInput(5200)).toBe(true);
      expect(tracker.hadRecentInput(6000)).toBe(false);

      const report = tracker.generateReport();
      expect(report.totalEntries).toBe(2);

      tracker.reset();
      expect(tracker.getEntries()).toHaveLength(0);
      expect(tracker.hadRecentInput(5200)).toBe(false);
    });
  });
});
