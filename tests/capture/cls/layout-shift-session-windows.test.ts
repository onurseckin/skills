import { describe, expect, it } from "bun:test";
import {
  detectLayoutShiftBetweenSnapshots,
  identifyRootCausingElements,
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

function disp(
  partial: Partial<UnstableElementDisplacement> & { selector: string; tagName: string },
): UnstableElementDisplacement {
  const p = partial.previousRect ?? { x: 0, y: 0, width: 50, height: 50 };
  const c = partial.currentRect ?? { x: 0, y: 10, width: 50, height: 50 };
  return {
    deltaX: 0,
    deltaY: 10,
    deltaWidth: 0,
    deltaHeight: 0,
    maxDisplacement: 10,
    horizontalDisplacement: 0,
    verticalDisplacement: 10,
    isRootCause: false,
    isExcluded: false,
    previousStyles: {} as never,
    currentStyles: {} as never,
    ...partial,
    previousRect: p,
    currentRect: c,
  };
}

describe("layout-shift-tracker: snapshot detection & root cause analysis", () => {
  describe("identifyRootCausingElements", () => {
    it("returns empty arrays for empty displacements", () => {
      expect(identifyRootCausingElements([])).toEqual({
        rootCauses: [],
        dependentDisplacements: [],
      });
    });

    it("passes excluded items directly into dependentDisplacements", () => {
      const excluded = disp({
        selector: "#excluded",
        tagName: "div",
        isExcluded: true,
        exclusionReason: "fixed_or_sticky",
      });

      const result = identifyRootCausingElements([excluded]);
      expect(result.dependentDisplacements).toHaveLength(1);
      expect(result.rootCauses).toHaveLength(0);
    });

    it("distinguishes root cause container and dependent nested child with same delta", () => {
      const parent = disp({
        selector: "#parent-box",
        tagName: "div",
        previousRect: { x: 0, y: 0, width: 500, height: 500 },
        currentRect: { x: 0, y: 100, width: 500, height: 500 },
        deltaY: 100,
        maxDisplacement: 100,
        verticalDisplacement: 100,
        isRootCause: true,
      });

      const child = disp({
        selector: "#child-button",
        tagName: "button",
        previousRect: { x: 50, y: 50, width: 100, height: 40 },
        currentRect: { x: 50, y: 150, width: 100, height: 40 },
        deltaY: 100,
        maxDisplacement: 100,
        verticalDisplacement: 100,
        isRootCause: true,
      });

      const result = identifyRootCausingElements([parent, child]);
      expect(result.rootCauses).toHaveLength(1);
      expect(result.rootCauses[0]?.selector).toBe("#parent-box");
      expect(result.rootCauses[0]?.rootCauseReason).toContain(
        "Element translated vertically by 100px",
      );
      expect(result.dependentDisplacements).toHaveLength(1);
      expect(result.dependentDisplacements[0]?.selector).toBe("#child-button");
    });

    it("formats different root cause reasons based on resized vs horizontal vs vertical vs primary", () => {
      const resized = disp({
        selector: "#resized",
        tagName: "div",
        previousRect: { x: 0, y: 0, width: 100, height: 100 },
        currentRect: { x: 0, y: 0, width: 150, height: 200 },
        deltaY: 0,
        deltaWidth: 50,
        deltaHeight: 100,
        maxDisplacement: 100,
        verticalDisplacement: 0,
        isRootCause: true,
      });

      const horizontal = disp({
        selector: "#horizontal",
        tagName: "div",
        previousRect: { x: 0, y: 0, width: 100, height: 100 },
        currentRect: { x: 40, y: 0, width: 100, height: 100 },
        deltaX: 40,
        deltaY: 0,
        maxDisplacement: 40,
        horizontalDisplacement: 40,
        verticalDisplacement: 0,
        isRootCause: true,
      });

      const primary = disp({
        selector: "#primary",
        tagName: "div",
        previousRect: { x: 500, y: 500, width: 100, height: 100 },
        currentRect: { x: 500, y: 500, width: 102, height: 102 },
        deltaY: 0,
        deltaWidth: 2,
        deltaHeight: 2,
        maxDisplacement: 2,
        verticalDisplacement: 0,
        isRootCause: true,
      });

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

  describe("detectLayoutShiftBetweenSnapshots", () => {
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
});
