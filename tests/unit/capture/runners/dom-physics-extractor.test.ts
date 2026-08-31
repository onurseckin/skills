import { describe, expect, it } from "bun:test";
import {
  computeLayoutMetrics,
  createEmptyDomPhysicsSnapshot,
  DOM_PHYSICS_EXTRACTION_SCRIPT,
  extractDomPhysics,
} from "../../../../olt/scripts/src/capture/runners/dom-physics-extractor.ts";
import type {
  CapturePageDriver,
  DomPhysicsSnapshot,
  ExtractedElementPhysics,
} from "../../../../olt/scripts/src/capture/runners/types.ts";

function createTestElement(overrides: Partial<ExtractedElementPhysics> = {}): ExtractedElementPhysics {
  return {
    selector: "#elem",
    tagName: "div",
    bounds: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
    },
    computedStyles: {
      display: "block",
      position: "static",
      zIndex: 0,
      color: "rgb(0,0,0)",
      backgroundColor: "rgb(255,255,255)",
      overflowX: "visible",
      overflowY: "visible",
    },
    metrics: {
      scrollWidth: 100,
      clientWidth: 100,
      scrollHeight: 100,
      clientHeight: 100,
      offsetWidth: 100,
      offsetHeight: 100,
    },
    textSnippet: "Sample text",
    ...overrides,
  };
}

describe("dom-physics-extractor", () => {
  describe("DOM_PHYSICS_EXTRACTION_SCRIPT", () => {
    it("is a non-empty string containing extraction logic", () => {
      expect(typeof DOM_PHYSICS_EXTRACTION_SCRIPT).toBe("string");
      expect(DOM_PHYSICS_EXTRACTION_SCRIPT.length).toBeGreaterThan(100);
      expect(DOM_PHYSICS_EXTRACTION_SCRIPT).toContain("querySelectorAll");
    });
  });

  describe("createEmptyDomPhysicsSnapshot", () => {
    it("creates snapshot with default dimensions", () => {
      const snap = createEmptyDomPhysicsSnapshot();
      expect(snap.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
      expect(snap.scrollPosition).toEqual({ x: 0, y: 0 });
      expect(snap.elements).toEqual([]);
      expect(snap.layoutOverflows).toEqual([]);
      expect(snap.textClippings).toEqual([]);
      expect(typeof snap.capturedAt).toBe("string");
    });

    it("creates snapshot with custom dimensions and scale factor", () => {
      const snap = createEmptyDomPhysicsSnapshot(1920, 1080, 2);
      expect(snap.viewport).toEqual({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    });
  });

  describe("computeLayoutMetrics", () => {
    it("detects horizontal scroll overflow when scrollWidth > clientWidth", () => {
      const el = createTestElement({
        selector: "#overflowing-container",
        metrics: {
          scrollWidth: 250,
          clientWidth: 200,
          scrollHeight: 100,
          clientHeight: 100,
          offsetWidth: 200,
          offsetHeight: 100,
        },
      });

      const metrics = computeLayoutMetrics([el], 1000, 1000, 0.5);
      expect(metrics.layoutOverflows).toHaveLength(1);
      expect(metrics.layoutOverflows[0]).toEqual({
        selector: "#overflowing-container",
        overflowX: 50,
        scrollWidth: 250,
        clientWidth: 200,
      });
      expect(metrics.textClippings).toHaveLength(0);
    });

    it("detects viewport bound overflow for non-fixed elements exceeding viewport width", () => {
      const el = createTestElement({
        selector: "#wide-elem",
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
          zIndex: 0,
          color: "#000",
          backgroundColor: "#fff",
          overflowX: "visible",
          overflowY: "visible",
        },
      });

      const metrics = computeLayoutMetrics([el], 1000, 800, 0.5);
      expect(metrics.layoutOverflows).toHaveLength(1);
      expect(metrics.layoutOverflows[0]?.overflowX).toBe(100);
    });

    it("ignores viewport bound overflow for position:fixed elements horizontally", () => {
      const fixedEl = createTestElement({
        selector: "#fixed-bar",
        bounds: {
          x: 0,
          y: 0,
          width: 1200,
          height: 50,
          left: 0,
          top: 0,
          right: 1200,
          bottom: 50,
        },
        computedStyles: {
          display: "block",
          position: "fixed",
          zIndex: 10,
          color: "#000",
          backgroundColor: "#fff",
          overflowX: "visible",
          overflowY: "visible",
        },
      });

      const metrics = computeLayoutMetrics([fixedEl], 1000, 800, 0.5);
      expect(metrics.layoutOverflows).toHaveLength(0);
    });

    it("detects vertical text clipping when scrollHeight > clientHeight and overflowY is hidden", () => {
      const el = createTestElement({
        selector: "#clipped-paragraph",
        computedStyles: {
          display: "block",
          position: "static",
          zIndex: 0,
          color: "#000",
          backgroundColor: "#fff",
          overflowX: "visible",
          overflowY: "hidden",
        },
        metrics: {
          scrollWidth: 200,
          clientWidth: 200,
          scrollHeight: 150,
          clientHeight: 100,
          offsetWidth: 200,
          offsetHeight: 100,
        },
        textSnippet: "This is truncated text that overflows the box",
      });

      const metrics = computeLayoutMetrics([el], 1000, 800, 0.5);
      expect(metrics.textClippings).toHaveLength(1);
      expect(metrics.textClippings[0]).toEqual({
        selector: "#clipped-paragraph",
        clippingY: 50,
        scrollHeight: 150,
        clientHeight: 100,
      });
    });

    it("detects vertical text clipping on position:fixed elements extending beyond viewportHeight", () => {
      const el = createTestElement({
        selector: "#fixed-panel",
        bounds: {
          x: 0,
          y: 500,
          width: 300,
          height: 400,
          left: 0,
          top: 500,
          right: 300,
          bottom: 900,
        },
        computedStyles: {
          display: "block",
          position: "fixed",
          zIndex: 10,
          color: "#000",
          backgroundColor: "#fff",
          overflowX: "visible",
          overflowY: "hidden",
        },
        metrics: {
          scrollWidth: 300,
          clientWidth: 300,
          scrollHeight: 400,
          clientHeight: 400,
          offsetWidth: 300,
          offsetHeight: 400,
        },
        textSnippet: "Fixed panel content",
      });

      const metrics = computeLayoutMetrics([el], 1000, 800, 0.5);
      expect(metrics.textClippings).toHaveLength(1);
      expect(metrics.textClippings[0]?.clippingY).toBe(100);
    });

    it("ignores text clipping when overflowY is not hidden or textSnippet is empty", () => {
      const visibleOverflowEl = createTestElement({
        computedStyles: {
          display: "block",
          position: "static",
          zIndex: 0,
          color: "#000",
          backgroundColor: "#fff",
          overflowX: "visible",
          overflowY: "visible",
        },
        metrics: {
          scrollWidth: 100,
          clientWidth: 100,
          scrollHeight: 200,
          clientHeight: 100,
          offsetWidth: 100,
          offsetHeight: 100,
        },
        textSnippet: "Visible overflow",
      });

      const emptyTextEl = createTestElement({
        computedStyles: {
          display: "block",
          position: "static",
          zIndex: 0,
          color: "#000",
          backgroundColor: "#fff",
          overflowX: "visible",
          overflowY: "hidden",
        },
        metrics: {
          scrollWidth: 100,
          clientWidth: 100,
          scrollHeight: 200,
          clientHeight: 100,
          offsetWidth: 100,
          offsetHeight: 100,
        },
        textSnippet: "",
      });

      const metrics = computeLayoutMetrics([visibleOverflowEl, emptyTextEl], 1000, 800);
      expect(metrics.textClippings).toHaveLength(0);
    });

    it("returns empty metrics when all elements fit within boundaries", () => {
      const el = createTestElement();
      const metrics = computeLayoutMetrics([el], 1000, 1000);
      expect(metrics.layoutOverflows).toEqual([]);
      expect(metrics.textClippings).toEqual([]);
    });
  });

  describe("extractDomPhysics", () => {
    it("returns extracted snapshot when driver.evaluate succeeds with valid snapshot", async () => {
      const expectedSnapshot: DomPhysicsSnapshot = {
        viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
        scrollPosition: { x: 0, y: 50 },
        elements: [createTestElement()],
        layoutOverflows: [],
        textClippings: [],
        capturedAt: new Date().toISOString(),
      };

      const driver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => expectedSnapshot as never,
      };

      const snapshot = await extractDomPhysics(driver);
      expect(snapshot).toEqual(expectedSnapshot);
    });

    it("falls back to empty snapshot when driver.evaluate throws", async () => {
      const driver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => {
          throw new Error("Page crashed or detached");
        },
      };

      const snapshot = await extractDomPhysics(driver, {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2,
      });

      expect(snapshot.viewport).toEqual({ width: 1920, height: 1080, deviceScaleFactor: 2 });
      expect(snapshot.elements).toEqual([]);
    });

    it("falls back to empty snapshot when driver.evaluate returns invalid structure", async () => {
      const driver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => ({ invalid: true } as never),
      };

      const snapshot = await extractDomPhysics(driver);
      expect(snapshot.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
      expect(snapshot.elements).toEqual([]);
    });
  });
});
