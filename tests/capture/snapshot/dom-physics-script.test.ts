import { describe, expect, it } from "bun:test";
import {
  createEmptyDomPhysicsSnapshot,
  DOM_PHYSICS_EXTRACTION_SCRIPT,
  extractDomPhysics,
} from "../../../olt/scripts/src/capture/runners/dom-physics-extractor.ts";
import type {
  CapturePageDriver,
  DomPhysicsSnapshot,
} from "../../../olt/scripts/src/capture/runners/types.ts";

describe("dom-physics-extractor: extraction script & driver evaluation", () => {
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
          private readonly rect: { x: number; y: number; width: number; height: number } = {
            x: 0,
            y: 0,
            width: 100,
            height: 50,
          },
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

      const elWithId = new MockHTMLElement(
        "BUTTON",
        "submit-btn",
        "btn btn-primary hover:bg-blue",
        "Submit form",
        {
          display: "block",
          position: "relative",
          zIndex: "10",
          color: "rgb(0,0,0)",
          backgroundColor: "rgb(255,255,255)",
          overflowX: "visible",
          overflowY: "visible",
        },
        { x: 10, y: 20, width: 120, height: 40 },
        {},
        { role: "button", "aria-label": "Submit" },
      );

      const elWithClass = new MockHTMLElement(
        "DIV",
        "",
        "card card-body active:scale",
        "Card body text",
        {
          display: "flex",
          position: "static",
          zIndex: "auto",
          overflowX: "hidden",
          overflowY: "hidden",
        },
        { x: 0, y: 0, width: 200, height: 100 },
        { scrollWidth: 250, clientWidth: 200, scrollHeight: 150, clientHeight: 100 },
      );

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
        querySelectorAll: () => [elWithId, elWithClass, elHidden, elSvg, {}],
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

      Object.defineProperty(globalThis, "window", {
        value: mockWindow,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, "document", {
        value: mockDocument,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, "HTMLElement", {
        value: MockHTMLElement,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, "SVGElement", {
        value: MockSVGElement,
        configurable: true,
        writable: true,
      });

      try {
        const scriptFn = new Function(`return (${DOM_PHYSICS_EXTRACTION_SCRIPT});`);
        const snapshot = scriptFn() as DomPhysicsSnapshot;

        expect(snapshot.viewport.width).toBe(1440);
        expect(snapshot.viewport.height).toBe(900);
        expect(snapshot.viewport.deviceScaleFactor).toBe(2);
        expect(snapshot.scrollPosition).toEqual({ x: 0, y: 10 });
        expect(snapshot.elements.length).toBe(3);
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

  describe("extractDomPhysics", () => {
    it("returns extracted snapshot when driver.evaluate succeeds with valid snapshot", async () => {
      const expectedSnapshot: DomPhysicsSnapshot = {
        viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
        scrollPosition: { x: 0, y: 50 },
        elements: [],
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
        evaluate: async () => ({ invalid: true }) as never,
      };

      const snapshot = await extractDomPhysics(driver);
      expect(snapshot.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
      expect(snapshot.elements).toEqual([]);
    });
  });
});
