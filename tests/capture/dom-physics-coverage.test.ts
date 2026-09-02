import { describe, expect, it } from "bun:test";
import {
  computeLayoutMetrics,
  createEmptyDomPhysicsSnapshot,
  DOM_PHYSICS_EXTRACTION_SCRIPT,
  extractDomPhysics,
} from "../../olt/scripts/src/capture/runners/dom-physics-extractor.ts";
import type {
  CapturePageDriver,
  ExtractedElementPhysics,
} from "../../olt/scripts/src/capture/runners/types.ts";

function mockEl(overrides: Partial<ExtractedElementPhysics> = {}): ExtractedElementPhysics {
  return {
    selector: "#node",
    tagName: "div",
    bounds: { x: 0, y: 0, width: 100, height: 50, left: 0, top: 0, right: 100, bottom: 50 },
    computedStyles: {
      display: "block",
      position: "static",
      zIndex: 0,
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgb(255, 255, 255)",
      overflowX: "visible",
      overflowY: "visible",
    },
    metrics: {
      scrollWidth: 100,
      clientWidth: 100,
      scrollHeight: 50,
      clientHeight: 50,
      offsetWidth: 100,
      offsetHeight: 50,
    },
    textSnippet: "Sample text",
    ...overrides,
  };
}

describe("dom-physics-extractor coverage suite", () => {
  describe("computeLayoutMetrics", () => {
    it("detects horizontal scroll overflow and respects subpixel tolerance", () => {
      const el = mockEl({
        selector: "#scroll-box",
        metrics: {
          scrollWidth: 260,
          clientWidth: 200,
          scrollHeight: 50,
          clientHeight: 50,
          offsetWidth: 200,
          offsetHeight: 50,
        },
      });
      const res = computeLayoutMetrics([el], 1000, 800, 0.5);
      expect(res.layoutOverflows).toHaveLength(1);
      expect(res.layoutOverflows[0]).toEqual({
        selector: "#scroll-box",
        overflowX: 60,
        scrollWidth: 260,
        clientWidth: 200,
      });

      const belowTol = mockEl({
        metrics: {
          scrollWidth: 100.2,
          clientWidth: 100,
          scrollHeight: 50,
          clientHeight: 50,
          offsetWidth: 100,
          offsetHeight: 50,
        },
      });
      expect(computeLayoutMetrics([belowTol], 1000, 800, 0.5).layoutOverflows).toHaveLength(0);
    });

    it("detects viewport bound horizontal overflow for non-fixed elements", () => {
      const el = mockEl({
        selector: "#vp-overflow",
        bounds: {
          x: 900,
          y: 0,
          width: 200,
          height: 50,
          left: 900,
          top: 0,
          right: 1100,
          bottom: 50,
        },
        computedStyles: {
          display: "block",
          position: "relative",
          overflowX: "visible",
          overflowY: "visible",
        },
      });
      const res = computeLayoutMetrics([el], 1000, 800, 0.5);
      expect(res.layoutOverflows).toHaveLength(1);
      expect(res.layoutOverflows[0].overflowX).toBe(100);

      // Fixed position does not trigger right bound overflow
      const fixedEl = mockEl({
        selector: "#fixed-nav",
        bounds: {
          x: 900,
          y: 0,
          width: 200,
          height: 50,
          left: 900,
          top: 0,
          right: 1100,
          bottom: 50,
        },
        computedStyles: {
          display: "block",
          position: "fixed",
          overflowX: "visible",
          overflowY: "visible",
        },
      });
      expect(computeLayoutMetrics([fixedEl], 1000, 800, 0.5).layoutOverflows).toHaveLength(0);

      // Viewport width <= 0 disables viewport right bound check
      expect(computeLayoutMetrics([el], 0, 800, 0.5).layoutOverflows).toHaveLength(0);
    });

    it("detects vertical text clipping for hidden overflow with text", () => {
      const el = mockEl({
        selector: "#clipped-p",
        textSnippet: "Long description text",
        computedStyles: {
          display: "block",
          position: "static",
          overflowX: "visible",
          overflowY: "hidden",
        },
        metrics: {
          scrollWidth: 100,
          clientWidth: 100,
          scrollHeight: 150,
          clientHeight: 50,
          offsetWidth: 100,
          offsetHeight: 50,
        },
      });
      const res = computeLayoutMetrics([el], 1000, 800, 0.5);
      expect(res.textClippings).toHaveLength(1);
      expect(res.textClippings[0]).toEqual({
        selector: "#clipped-p",
        clippingY: 100,
        scrollHeight: 150,
        clientHeight: 50,
      });

      // Not clipped if overflowY is not hidden
      const elVisible = mockEl({
        ...el,
        computedStyles: { ...el.computedStyles, overflowY: "visible" },
      });
      expect(computeLayoutMetrics([elVisible], 1000, 800, 0.5).textClippings).toHaveLength(0);

      // Not clipped if textSnippet is empty
      const elEmpty = mockEl({
        ...el,
        textSnippet: "",
      });
      expect(computeLayoutMetrics([elEmpty], 1000, 800, 0.5).textClippings).toHaveLength(0);
    });

    it("detects fixed position bottom boundary text clipping", () => {
      const fixedClipped = mockEl({
        selector: "#fixed-bottom",
        textSnippet: "Pinned footer text",
        bounds: {
          x: 0,
          y: 700,
          width: 100,
          height: 200,
          left: 0,
          top: 700,
          right: 100,
          bottom: 900,
        },
        computedStyles: {
          display: "block",
          position: "fixed",
          overflowX: "visible",
          overflowY: "hidden",
        },
      });
      const res = computeLayoutMetrics([fixedClipped], 1000, 800, 0.5);
      expect(res.textClippings).toHaveLength(1);
      expect(res.textClippings[0].clippingY).toBe(100);

      // Relative position does not trigger bottom bound clipping
      const relEl = mockEl({
        ...fixedClipped,
        computedStyles: { ...fixedClipped.computedStyles, position: "relative" },
      });
      expect(computeLayoutMetrics([relEl], 1000, 800, 0.5).textClippings).toHaveLength(0);

      // Viewport height <= 0 disables viewport bottom bound check
      expect(computeLayoutMetrics([fixedClipped], 1000, 0, 0.5).textClippings).toHaveLength(0);
    });
  });

  describe("createEmptyDomPhysicsSnapshot", () => {
    it("returns default snapshot structure and allows parameter overrides", () => {
      const def = createEmptyDomPhysicsSnapshot();
      expect(def.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
      expect(def.scrollPosition).toEqual({ x: 0, y: 0 });
      expect(def.elements).toEqual([]);
      expect(def.layoutOverflows).toEqual([]);
      expect(def.textClippings).toEqual([]);
      expect(typeof def.capturedAt).toBe("string");

      const custom = createEmptyDomPhysicsSnapshot(375, 812, 3);
      expect(custom.viewport).toEqual({ width: 375, height: 812, deviceScaleFactor: 3 });
    });
  });

  describe("extractDomPhysics", () => {
    it("returns driver result when valid object with elements array is returned", async () => {
      const snapshot = createEmptyDomPhysicsSnapshot(1280, 720, 2);
      const driver: CapturePageDriver = {
        evaluate: async () => snapshot,
      };
      const result = await extractDomPhysics(driver);
      expect(result).toBe(snapshot);
    });

    it("falls back to empty snapshot on driver failure or invalid result", async () => {
      const failingDriver: CapturePageDriver = {
        evaluate: async () => {
          throw new Error("Crash");
        },
      };
      const res1 = await extractDomPhysics(failingDriver, {
        width: 800,
        height: 600,
        deviceScaleFactor: 2,
      });
      expect(res1.viewport).toEqual({ width: 800, height: 600, deviceScaleFactor: 2 });

      const resDefault = await extractDomPhysics(failingDriver);
      expect(resDefault.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });

      const invalidDriver: CapturePageDriver = {
        evaluate: async () => null as unknown as ReturnType<typeof createEmptyDomPhysicsSnapshot>,
      };
      const resNull = await extractDomPhysics(invalidDriver);
      expect(resNull.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
    });
  });

  describe("DOM_PHYSICS_EXTRACTION_SCRIPT", () => {
    it("contains extraction primitives for selectors, bounding boxes, and metrics", () => {
      expect(typeof DOM_PHYSICS_EXTRACTION_SCRIPT).toBe("string");
      expect(DOM_PHYSICS_EXTRACTION_SCRIPT.length).toBeGreaterThan(100);
      expect(DOM_PHYSICS_EXTRACTION_SCRIPT).toContain("querySelectorAll");
      expect(DOM_PHYSICS_EXTRACTION_SCRIPT).toContain("layoutOverflows");
      expect(DOM_PHYSICS_EXTRACTION_SCRIPT).toContain("textClippings");
    });
  });
});
