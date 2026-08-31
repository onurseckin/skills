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

    it("evaluates in-browser script correctly against mock DOM nodes", () => {
      class MockHTMLElement {
        constructor(
          public tagName: string,
          public id: string = "",
          public className: string = "",
          public textContent: string = "",
          private readonly style: Record<string, string> = {},
          private readonly rect: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 100, height: 50 },
          private readonly metrics: Record<string, number> = {},
          private readonly attributes: Record<string, string> = {},
        ) {}

        getAttribute(name: string): string | null {
          return this.attributes[name] ?? null;
        }

        getBoundingClientRect() {
          return {
            x: this.rect.x,
            y: this.rect.y,
            width: this.rect.width,
            height: this.rect.height,
            top: this.rect.y,
            bottom: this.rect.y + this.rect.height,
            left: this.rect.x,
            right: this.rect.x + this.rect.width,
          };
        }

        get scrollWidth() {
          return this.metrics.scrollWidth ?? this.rect.width;
        }
        get clientWidth() {
          return this.metrics.clientWidth ?? this.rect.width;
        }
        get scrollHeight() {
          return this.metrics.scrollHeight ?? this.rect.height;
        }
        get clientHeight() {
          return this.metrics.clientHeight ?? this.rect.height;
        }
        get offsetWidth() {
          return this.metrics.offsetWidth ?? this.rect.width;
        }
        get offsetHeight() {
          return this.metrics.offsetHeight ?? this.rect.height;
        }
      }

      class MockSVGElement extends MockHTMLElement {}

      const elWithId = new MockHTMLElement("BUTTON", "submit-btn", "btn btn-primary hover:bg-blue", "Submit form", {
        display: "block",
        position: "relative",
        zIndex: "10",
        color: "rgb(0,0,0)",
        backgroundColor: "rgb(255,255,255)",
        overflowX: "visible",
        overflowY: "visible",
      }, { x: 10, y: 20, width: 120, height: 40 }, {}, { role: "button", "aria-label": "Submit" });

      const elWithClass = new MockHTMLElement("DIV", "", "card card-body active:scale", "Card body text", {
        display: "flex",
        position: "static",
        zIndex: "auto",
        overflowX: "hidden",
        overflowY: "hidden",
      }, { x: 0, y: 0, width: 200, height: 100 }, { scrollWidth: 250, clientWidth: 200, scrollHeight: 150, clientHeight: 100 });

      const elHidden = new MockHTMLElement("SPAN", "", "", "Hidden", {
        display: "none",
        visibility: "hidden",
      });

      const elSvg = new MockSVGElement("SVG", "icon-check", "", "", {
        display: "inline-block",
        position: "static",
        zIndex: "auto",
      });

      const mockDocument = {
        documentElement: { clientWidth: 1440, clientHeight: 900 },
        querySelectorAll: () => [elWithId, elWithClass, elHidden, elSvg, {} /* non-element node */],
      };

      const mockGetComputedStyle = (node: { style?: Record<string, string> }) => ({
        display: node.style?.display ?? "block",
        visibility: node.style?.visibility ?? "visible",
        position: node.style?.position ?? "static",
        zIndex: node.style?.zIndex ?? "auto",
        color: node.style?.color ?? "rgb(0,0,0)",
        backgroundColor: node.style?.backgroundColor ?? "transparent",
        overflowX: node.style?.overflowX ?? "visible",
        overflowY: node.style?.overflowY ?? "visible",
        fontSize: "16px",
        lineHeight: "24px",
        opacity: "1",
      });

      const mockWindow = {
        innerWidth: 1440,
        innerHeight: 900,
        scrollX: 0,
        scrollY: 10,
        devicePixelRatio: 2,
        getComputedStyle: mockGetComputedStyle,
      };

      Object.defineProperty(globalThis, "window", { value: mockWindow, configurable: true, writable: true });
      Object.defineProperty(globalThis, "document", { value: mockDocument, configurable: true, writable: true });
      Object.defineProperty(globalThis, "HTMLElement", { value: MockHTMLElement, configurable: true, writable: true });
      Object.defineProperty(globalThis, "SVGElement", { value: MockSVGElement, configurable: true, writable: true });

      try {
        const scriptFn = new Function(`return (${DOM_PHYSICS_EXTRACTION_SCRIPT});`);
        const snapshot = scriptFn() as DomPhysicsSnapshot;

        expect(snapshot.viewport.width).toBe(1440);
        expect(snapshot.viewport.height).toBe(900);
        expect(snapshot.viewport.deviceScaleFactor).toBe(2);
        expect(snapshot.scrollPosition).toEqual({ x: 0, y: 10 });
        expect(snapshot.elements.length).toBe(3); // elWithId, elWithClass, elSvg (hidden and non-element skipped)
        expect(snapshot.elements[0]?.selector).toBe("#submit-btn");
        expect(snapshot.elements[0]?.role).toBe("button");
        expect(snapshot.elements[0]?.ariaLabel).toBe("Submit");
        expect(snapshot.elements[1]?.selector).toBe("div.card.card-body");
        expect(snapshot.layoutOverflows.length).toBe(1);
        expect(snapshot.textClippings.length).toBe(1);
      } finally {
        Reflect.deleteProperty(globalThis, "window");
        Reflect.deleteProperty(globalThis, "document");
        Reflect.deleteProperty(globalThis, "HTMLElement");
        Reflect.deleteProperty(globalThis, "SVGElement");
      }
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
