import { describe, expect, it } from "bun:test";
import {
  computeLayoutMetrics,
  createEmptyDomPhysicsSnapshot,
  DOM_PHYSICS_EXTRACTION_SCRIPT,
  extractDomPhysics,
} from "../../../olt/scripts/src/capture/runners/dom-physics-extractor.ts";
import type {
  CapturePageDriver,
  ExtractedElementPhysics,
} from "../../../olt/scripts/src/capture/runners/types.ts";

function createMockElement(
  overrides: Partial<ExtractedElementPhysics> = {},
): ExtractedElementPhysics {
  return {
    selector: "div#main",
    tagName: "div",
    id: "main",
    bounds: { x: 0, y: 0, width: 200, height: 100, left: 0, top: 0, right: 200, bottom: 100 },
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
      scrollWidth: 200,
      clientWidth: 200,
      scrollHeight: 100,
      clientHeight: 100,
      offsetWidth: 200,
      offsetHeight: 100,
    },
    textSnippet: "Sample content snippet",
    ...overrides,
  };
}

describe("DOM Physics Extractor Edge Suite", () => {
  it("verifies extraction script string content", () => {
    expect(typeof DOM_PHYSICS_EXTRACTION_SCRIPT).toBe("string");
    expect(DOM_PHYSICS_EXTRACTION_SCRIPT).toContain("buildSelector");
    expect(DOM_PHYSICS_EXTRACTION_SCRIPT).toContain("getBoundingClientRect");
    expect(DOM_PHYSICS_EXTRACTION_SCRIPT).toContain("getComputedStyle");
    expect(DOM_PHYSICS_EXTRACTION_SCRIPT).toContain("layoutOverflows");
    expect(DOM_PHYSICS_EXTRACTION_SCRIPT).toContain("textClippings");
  });

  describe("computeLayoutMetrics", () => {
    it("handles empty element list and zero viewport width", () => {
      expect(computeLayoutMetrics([], 1440, 900)).toEqual({
        layoutOverflows: [],
        textClippings: [],
      });
      const el = createMockElement({
        bounds: {
          x: 100,
          y: 0,
          width: 500,
          height: 100,
          left: 100,
          top: 0,
          right: 600,
          bottom: 100,
        },
      });
      expect(computeLayoutMetrics([el], 0, 900, 0.5).layoutOverflows).toHaveLength(0);
      expect(computeLayoutMetrics([el], 1000, 0, 0.5).textClippings).toHaveLength(0);
    });

    it("detects horizontal overflow via scroll metrics exceeding tolerance", () => {
      const el = createMockElement({
        selector: "section.panel",
        metrics: {
          scrollWidth: 450,
          clientWidth: 300,
          scrollHeight: 100,
          clientHeight: 100,
          offsetWidth: 300,
          offsetHeight: 100,
        },
      });
      const result = computeLayoutMetrics([el], 1440, 900, 0.5);
      expect(result.layoutOverflows).toHaveLength(1);
      expect(result.layoutOverflows[0]).toEqual({
        selector: "section.panel",
        overflowX: 150,
        scrollWidth: 450,
        clientWidth: 300,
      });
    });

    it("detects horizontal viewport overflow and respects fixed positioning", () => {
      const relEl = createMockElement({
        selector: "aside.sidebar",
        bounds: {
          x: 1300,
          y: 0,
          width: 300,
          height: 100,
          left: 1300,
          top: 0,
          right: 1600,
          bottom: 100,
        },
        computedStyles: {
          display: "block",
          position: "absolute",
          zIndex: 1,
          color: "rgb(0,0,0)",
          backgroundColor: "rgb(255,255,255)",
          overflowX: "visible",
          overflowY: "visible",
        },
      });
      expect(computeLayoutMetrics([relEl], 1440, 900, 0.5).layoutOverflows[0]?.overflowX).toBe(160);

      const fixedEl = createMockElement({
        ...relEl,
        computedStyles: { ...relEl.computedStyles, position: "fixed" },
      });
      expect(computeLayoutMetrics([fixedEl], 1440, 900, 0.5).layoutOverflows).toHaveLength(0);
    });

    it("detects text clipping when overflowY is hidden and ignores empty text", () => {
      const el = createMockElement({
        selector: "p.description",
        textSnippet: "Truncated text",
        computedStyles: {
          display: "block",
          position: "static",
          zIndex: 0,
          color: "rgb(0,0,0)",
          backgroundColor: "rgb(255,255,255)",
          overflowX: "visible",
          overflowY: "hidden",
        },
        metrics: {
          scrollWidth: 200,
          clientWidth: 200,
          scrollHeight: 240,
          clientHeight: 80,
          offsetWidth: 200,
          offsetHeight: 80,
        },
      });
      const result = computeLayoutMetrics([el], 1440, 900, 0.5);
      expect(result.textClippings[0]?.clippingY).toBe(160);

      const emptySnippet = createMockElement({ ...el, textSnippet: "" });
      expect(computeLayoutMetrics([emptySnippet], 1440, 900, 0.5).textClippings).toHaveLength(0);
    });

    it("detects fixed element bottom boundary clipping and ignores relative position", () => {
      const fixed = createMockElement({
        selector: "footer.fixed-bottom",
        textSnippet: "Footer",
        bounds: {
          x: 0,
          y: 850,
          width: 500,
          height: 150,
          left: 0,
          top: 850,
          right: 500,
          bottom: 1000,
        },
        computedStyles: {
          display: "block",
          position: "fixed",
          zIndex: 10,
          color: "rgb(0,0,0)",
          backgroundColor: "rgb(0,0,0)",
          overflowX: "visible",
          overflowY: "hidden",
        },
      });
      expect(computeLayoutMetrics([fixed], 1440, 900, 0.5).textClippings[0]?.clippingY).toBe(100);

      const rel = createMockElement({
        ...fixed,
        computedStyles: { ...fixed.computedStyles, position: "relative" },
      });
      expect(computeLayoutMetrics([rel], 1440, 900, 0.5).textClippings).toHaveLength(0);
    });
  });

  describe("createEmptyDomPhysicsSnapshot", () => {
    it("creates snapshot with defaults and custom overrides", () => {
      const def = createEmptyDomPhysicsSnapshot();
      expect(def.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
      expect(def.scrollPosition).toEqual({ x: 0, y: 0 });
      expect(def.elements).toEqual([]);
      expect(typeof def.capturedAt).toBe("string");

      const custom = createEmptyDomPhysicsSnapshot(1920, 1080, 2);
      expect(custom.viewport).toEqual({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    });
  });

  describe("extractDomPhysics", () => {
    it("returns driver evaluation snapshot on success", async () => {
      const snap = createEmptyDomPhysicsSnapshot(1280, 720, 1.5);
      const driver: CapturePageDriver = { evaluate: async () => snap };
      expect(await extractDomPhysics(driver)).toBe(snap);
    });

    it("returns fallback snapshot on error or invalid evaluate response", async () => {
      const failDriver: CapturePageDriver = {
        evaluate: async () => {
          throw new Error("Page detached");
        },
      };
      const res1 = await extractDomPhysics(failDriver, {
        width: 1024,
        height: 768,
        deviceScaleFactor: 2,
      });
      expect(res1.viewport).toEqual({ width: 1024, height: 768, deviceScaleFactor: 2 });
      expect(res1.elements).toEqual([]);

      const invalidDriver: CapturePageDriver = {
        evaluate: async () =>
          ({ invalid: true }) as unknown as ReturnType<typeof createEmptyDomPhysicsSnapshot>,
      };
      const res2 = await extractDomPhysics(invalidDriver, { width: 800, height: 600 });
      expect(res2.viewport).toEqual({ width: 800, height: 600, deviceScaleFactor: 1 });
    });
  });
});
