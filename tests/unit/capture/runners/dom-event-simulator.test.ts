import { describe, expect, it } from "bun:test";
import {
  buildSyntheticInteractionPlan,
  classifyLayoutShift,
  DEFAULT_DOM_SIMULATION_OPTIONS,
  DOM_EVENT_DISPATCH_SCRIPT,
  DomEventSimulator,
  resolveDomSimulationOptions,
  simulateDomEvent,
  type DomSimulationOptions,
  type SyntheticDomEvent,
  type UnexpectedShiftDefect,
} from "../../../../olt/scripts/src/capture/runners/dom-event-simulator/index.ts";
import {
  DEFAULT_LAYOUT_SHIFT_OPTIONS,
  type LayoutShiftEntry,
} from "../../../../olt/scripts/src/capture/runners/layout-shift-tracker/index.ts";
import type {
  CapturePageDriver,
  DomPhysicsSnapshot,
  ExtractedElementPhysics,
} from "../../../../olt/scripts/src/capture/runners/types.ts";

function createMockElement(selector: string, tagName: string, role?: string): ExtractedElementPhysics {
  return {
    selector,
    tagName,
    role,
    bounds: { x: 0, y: 0, width: 100, height: 40, left: 0, right: 100, top: 0, bottom: 40 },
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
      scrollHeight: 40,
      clientHeight: 40,
      offsetWidth: 100,
      offsetHeight: 40,
    },
  };
}

function createMockShiftEntry(
  score: number,
  sourcesCount = 1,
  rootCauses: { selector: string }[] = [],
): LayoutShiftEntry {
  return {
    id: `shift-${Date.now()}`,
    timestamp: Date.now(),
    impactFraction: score > 0 ? 0.5 : 0,
    distanceFraction: score > 0 ? score / 0.5 : 0,
    score,
    hadRecentInput: false,
    sources: new Array(sourcesCount).fill({ isExcluded: false }) as never,
    rootCauses: rootCauses.map((rc) => ({
      selector: rc.selector,
      tagName: "div",
      previousRect: { x: 0, y: 0, width: 10, height: 10 },
      currentRect: { x: 0, y: 10, width: 10, height: 10 },
      deltaX: 0,
      deltaY: 10,
      deltaWidth: 0,
      deltaHeight: 0,
      maxDisplacement: 10,
      horizontalDisplacement: 0,
      verticalDisplacement: 10,
      isRootCause: true,
      isExcluded: false,
      previousStyles: {} as never,
      currentStyles: {} as never,
    })),
    viewport: { width: 1000, height: 1000 },
    isValidShift: score > 0,
  };
}

describe("dom-event-simulator", () => {
  describe("options", () => {
    it("resolveDomSimulationOptions uses defaults when options undefined", () => {
      const resolved = resolveDomSimulationOptions();
      expect(resolved.settleDelayMs).toBe(50);
      expect(resolved.clsThreshold).toBe(0.1);
      expect(resolved.failOnUnexpectedShift).toBe(false);
      expect(resolved.trackerOptions).toEqual(DEFAULT_LAYOUT_SHIFT_OPTIONS);
    });

    it("resolveDomSimulationOptions merges partial overrides", () => {
      const custom: DomSimulationOptions = {
        settleDelayMs: 100,
        clsThreshold: 0.05,
        failOnUnexpectedShift: true,
        trackerOptions: {
          subpixelTolerance: 1.0,
        },
      };
      const resolved = resolveDomSimulationOptions(custom);
      expect(resolved.settleDelayMs).toBe(100);
      expect(resolved.clsThreshold).toBe(0.05);
      expect(resolved.failOnUnexpectedShift).toBe(true);
      expect(resolved.trackerOptions.subpixelTolerance).toBe(1.0);
    });
  });

  describe("evaluator", () => {
    describe("classifyLayoutShift", () => {
      it("returns isExpected true if shift score < 0.001 or sources empty", () => {
        const tinyShift = createMockShiftEntry(0.0005, 1);
        const event: SyntheticDomEvent = { type: "click", selector: "#btn" };
        expect(classifyLayoutShift(event, tinyShift, 0)).toEqual({ isExpected: true });

        const zeroSources = createMockShiftEntry(0.05, 0);
        expect(classifyLayoutShift(event, zeroSources, 0)).toEqual({ isExpected: true });
      });

      it("handles no_shift behavior across critical, moderate, and minor severities", () => {
        const eventWithSel: SyntheticDomEvent = { type: "hover", selector: "#card", expectedBehavior: "no_shift" };
        const eventWithoutSel: SyntheticDomEvent = { type: "scroll", expectedBehavior: "no_shift" };

        const critShift = createMockShiftEntry(0.15, 2);
        const resCrit = classifyLayoutShift(eventWithSel, critShift, 1);
        expect(resCrit.isExpected).toBe(false);
        expect(resCrit.defect?.severity).toBe("critical");
        expect(resCrit.defect?.selector).toBe("#card");

        const modShift = createMockShiftEntry(0.05, 2);
        const resMod = classifyLayoutShift(eventWithoutSel, modShift, 2);
        expect(resMod.isExpected).toBe(false);
        expect(resMod.defect?.severity).toBe("moderate");
        expect(resMod.defect?.selector).toBeUndefined();

        const minorShift = createMockShiftEntry(0.01, 1);
        const resMinor = classifyLayoutShift(eventWithSel, minorShift, 3);
        expect(resMinor.isExpected).toBe(false);
        expect(resMinor.defect?.severity).toBe("minor");
      });

      it("handles layout_expansion and modal_open when target is matched or omitted", () => {
        const noSelEvent: SyntheticDomEvent = { type: "click", expectedBehavior: "layout_expansion" };
        const shift = createMockShiftEntry(0.08, 1, [{ selector: "#modal" }]);
        expect(classifyLayoutShift(noSelEvent, shift, 0)).toEqual({ isExpected: true });

        const matchedEvent: SyntheticDomEvent = { type: "click", selector: "#accordion-item", expectedBehavior: "layout_expansion" };
        const matchedShift = createMockShiftEntry(0.08, 1, [{ selector: "#accordion-item-body" }]);
        expect(classifyLayoutShift(matchedEvent, matchedShift, 1)).toEqual({ isExpected: true });

        const unmatchedEvent: SyntheticDomEvent = { type: "click", selector: "#accordion", expectedBehavior: "layout_expansion" };
        const unmatchedShift = createMockShiftEntry(0.08, 1, [{ selector: "#footer-unrelated" }]);
        const resUnmatched = classifyLayoutShift(unmatchedEvent, unmatchedShift, 2);
        expect(resUnmatched.isExpected).toBe(true);
      });

      it("handles feedback_only shifts > 0.01 as defects and <= 0.01 as expected", () => {
        const event: SyntheticDomEvent = { type: "click", selector: "#btn", expectedBehavior: "feedback_only" };
        const smallShift = createMockShiftEntry(0.005, 1);
        expect(classifyLayoutShift(event, smallShift, 0)).toEqual({ isExpected: true });

        const critShift = createMockShiftEntry(0.2, 5);
        const critRes = classifyLayoutShift(event, critShift, 1);
        expect(critRes.isExpected).toBe(false);
        expect(critRes.defect?.severity).toBe("critical");

        const modShift = createMockShiftEntry(0.05, 2);
        const modRes = classifyLayoutShift(event, modShift, 2);
        expect(modRes.isExpected).toBe(false);
        expect(modRes.defect?.severity).toBe("moderate");
      });
    });

    describe("buildSyntheticInteractionPlan", () => {
      it("builds comprehensive sequence for buttons, text inputs, scroll, resize, and media queries", () => {
        const button = createMockElement("#submit-btn", "button");
        const roleButton = createMockElement("#custom-btn", "div", "button");
        const input = createMockElement("#email-input", "input");
        const textarea = createMockElement("#bio-text", "textarea");
        const textbox = createMockElement("#aria-box", "div", "textbox");
        const staticDiv = createMockElement("#container", "div");

        const plan = buildSyntheticInteractionPlan([button, roleButton, input, textarea, textbox, staticDiv], { width: 1440, height: 900 });

        expect(plan[0]?.type).toBe("wait");
        expect(plan.some((e) => e.type === "hover" && e.selector === "#submit-btn")).toBe(true);
        expect(plan.some((e) => e.type === "click" && e.selector === "#custom-btn")).toBe(true);
        expect(plan.some((e) => e.type === "focus" && e.selector === "#email-input")).toBe(true);
        expect(plan.some((e) => e.type === "input" && e.selector === "#bio-text")).toBe(true);
        expect(plan.some((e) => e.type === "blur" && e.selector === "#aria-box")).toBe(true);
        expect(plan.some((e) => e.type === "scroll")).toBe(true);
        expect(plan.some((e) => e.type === "resize" && e.viewport?.width === 375)).toBe(true);
        expect(plan.some((e) => e.type === "mediaQuery")).toBe(true);
      });

      it("skips viewport resize simulation when viewport width <= 600", () => {
        const plan = buildSyntheticInteractionPlan([], { width: 390, height: 844 });
        expect(plan.some((e) => e.type === "resize")).toBe(false);
      });
    });
  });

  describe("dispatchers", () => {
    describe("DOM_EVENT_DISPATCH_SCRIPT in-page script evaluation", () => {
      it("executes script against mocked DOM environment covering all dispatch branches", () => {
        const scriptFn = new Function(`return (${DOM_EVENT_DISPATCH_SCRIPT});`)() as (payload?: unknown) => void;

        const eventsDispatched: { type: string; event: string }[] = [];
        const classes = new Set<string>();
        const attributes: Record<string, string> = {};

        const mockElement = {
          tagName: "BUTTON",
          value: "",
          click: () => {
            eventsDispatched.push({ type: "click", event: "click_fn" });
          },
          focus: () => {
            eventsDispatched.push({ type: "focus", event: "focus_fn" });
          },
          blur: () => {
            eventsDispatched.push({ type: "blur", event: "blur_fn" });
          },
          scrollTo: (x: number, y: number) => {
            eventsDispatched.push({ type: "scroll", event: `scrollTo(${x},${y})` });
          },
          scrollBy: (x: number, y: number) => {
            eventsDispatched.push({ type: "scroll", event: `scrollBy(${x},${y})` });
          },
          dispatchEvent: (ev: { type: string }) => {
            eventsDispatched.push({ type: "event", event: ev.type });
            return true;
          },
        };

        const globalAny = globalThis as unknown as {
          document?: unknown;
          window?: unknown;
          MouseEvent?: unknown;
          FocusEvent?: unknown;
          KeyboardEvent?: unknown;
          Event?: unknown;
        };

        const origDoc = globalAny.document;
        const origWin = globalAny.window;
        const origMouseEvent = globalAny.MouseEvent;
        const origFocusEvent = globalAny.FocusEvent;
        const origKeyboardEvent = globalAny.KeyboardEvent;
        const origEvent = globalAny.Event;

        class MockEvent {
          constructor(public type: string, public init?: unknown) {}
        }

        globalAny.MouseEvent = MockEvent;
        globalAny.FocusEvent = MockEvent;
        globalAny.KeyboardEvent = MockEvent;
        globalAny.Event = MockEvent;

        globalAny.document = {
          body: mockElement,
          querySelector: (sel: string) => (sel === "#not-found" ? null : mockElement),
          documentElement: {
            classList: {
              toggle: (cls: string, val: boolean) => {
                if (val) classes.add(cls);
                else classes.delete(cls);
              },
            },
            setAttribute: (name: string, val: string) => {
              attributes[name] = val;
            },
          },
        };

        globalAny.window = {
          scrollTo: (x: number, y: number) => {
            eventsDispatched.push({ type: "scroll", event: `window.scrollTo(${x},${y})` });
          },
          scrollBy: (x: number, y: number) => {
            eventsDispatched.push({ type: "scroll", event: `window.scrollBy(${x},${y})` });
          },
        };

        try {
          // null / empty payload
          expect(() => scriptFn(null)).not.toThrow();
          expect(() => scriptFn(undefined)).not.toThrow();
          expect(() => scriptFn({})).not.toThrow();
          // click with click method
          scriptFn({ type: "click", selector: "#btn" });
          // click without click method
          const noClickMethodEl = {
            ...mockElement,
            click: undefined,
          };
          (globalAny.document as { querySelector: (s: string) => unknown }).querySelector = () => noClickMethodEl;
          scriptFn({ type: "click", selector: "#no-click" });

          // hover, mouseenter, mouseleave
          (globalAny.document as { querySelector: (s: string) => unknown }).querySelector = () => mockElement;
          scriptFn({ type: "hover", selector: "#btn" });
          scriptFn({ type: "mouseleave", selector: "#btn" });

          // scroll target scrollTo
          scriptFn({ type: "scroll", selector: "#btn", scrollX: 10, scrollY: 20 });
          // scroll target scrollBy
          scriptFn({ type: "scroll", selector: "#btn", scrollDeltaX: 5, scrollDeltaY: 15 });
          // scroll window scrollTo
          scriptFn({ type: "scroll", scrollX: 0, scrollY: 100 });
          // scroll window scrollBy
          scriptFn({ type: "scroll", scrollDeltaY: 50 });

          // focus, blur
          scriptFn({ type: "focus", selector: "#input" });
          scriptFn({ type: "blur", selector: "#input" });

          // input, keydown, keyup
          scriptFn({ type: "input", selector: "#input", text: "abc", key: "Enter" });
          scriptFn({ type: "keyup", selector: "#input", key: "Escape" });

          // mediaQuery dark theme
          scriptFn({ type: "mediaQuery", mediaQuery: "screen and (prefers-color-scheme: dark)", matches: true });
          expect(classes.has("dark")).toBe(true);
          expect(attributes["data-theme"]).toBe("dark");

          scriptFn({ type: "mediaQuery", mediaQuery: "screen and (prefers-color-scheme: dark)", matches: false });
          expect(classes.has("dark")).toBe(false);
          expect(attributes["data-theme"]).toBe("light");

          // mediaQuery reduced motion
          scriptFn({ type: "mediaQuery", mediaQuery: "(prefers-reduced-motion: reduce)", matches: true });
          expect(attributes["data-reduced-motion"]).toBe("true");

          // element not found branch
          (globalAny.document as { querySelector: (s: string) => unknown }).querySelector = () => null;
          scriptFn({ type: "click", selector: "#not-found" });
          scriptFn({ type: "hover", selector: "#not-found" });
          scriptFn({ type: "focus", selector: "#not-found" });
          scriptFn({ type: "input", selector: "#not-found" });
        } finally {
          globalAny.document = origDoc;
          globalAny.window = origWin;
          globalAny.MouseEvent = origMouseEvent;
          globalAny.FocusEvent = origFocusEvent;
          globalAny.KeyboardEvent = origKeyboardEvent;
          globalAny.Event = origEvent;
        }
      });
    });

    describe("simulateDomEvent", () => {
      it("dispatches click and dblclick using driver.click or driver.evaluate", async () => {
        const evaluatedCalls: unknown[] = [];
        let clickedSelector = "";

        const driverWithClick: CapturePageDriver = {
          setViewportSize: async () => {},
          setExtraHTTPHeaders: async () => {},
          click: async (sel) => {
            clickedSelector = sel;
          },
          goto: async () => {},
          waitForSelector: async () => {},
          screenshot: async () => Buffer.alloc(0),
          evaluate: async (script, payload) => {
            evaluatedCalls.push({ script, payload });
            return {} as never;
          },
        };

        await simulateDomEvent(driverWithClick, { type: "click", selector: "#target-btn" });
        expect(clickedSelector).toBe("#target-btn");

        const driverWithoutClick: CapturePageDriver = {
          setViewportSize: async () => {},
          setExtraHTTPHeaders: async () => {},
          goto: async () => {},
          waitForSelector: async () => {},
          screenshot: async () => Buffer.alloc(0),
          evaluate: async (script, payload) => {
            evaluatedCalls.push({ script, payload });
            return {} as never;
          },
        };

        await simulateDomEvent(driverWithoutClick, { type: "dblclick", selector: "#dbl-target" });
        expect(evaluatedCalls).toHaveLength(1);
        expect((evaluatedCalls[0] as { payload: { type: string } }).payload.type).toBe("dblclick");

        // Click with no selector
        await simulateDomEvent(driverWithoutClick, { type: "click" });
      });

      it("dispatches hover, mouseenter, and mouseleave", async () => {
        let hoveredSelector = "";
        const evaluatedCalls: unknown[] = [];

        const driverWithHover: CapturePageDriver = {
          setViewportSize: async () => {},
          setExtraHTTPHeaders: async () => {},
          hover: async (sel) => {
            hoveredSelector = sel;
          },
          goto: async () => {},
          waitForSelector: async () => {},
          screenshot: async () => Buffer.alloc(0),
          evaluate: async (script, payload) => {
            evaluatedCalls.push({ script, payload });
            return {} as never;
          },
        };

        await simulateDomEvent(driverWithHover, { type: "hover", selector: "#hover-target" });
        expect(hoveredSelector).toBe("#hover-target");

        await simulateDomEvent(driverWithHover, { type: "mouseenter", selector: "#hover-target" });
        await simulateDomEvent(driverWithHover, { type: "mouseleave", selector: "#hover-target" });
        expect(evaluatedCalls).toHaveLength(1);

        // Hover without selector
        await simulateDomEvent(driverWithHover, { type: "hover" });
        await simulateDomEvent(driverWithHover, { type: "mouseleave" });
      });

      it("dispatches scroll, focus, blur, keypress, resize, mediaQuery, wait, and custom", async () => {
        const evaluatedCalls: unknown[] = [];
        let filledSelector = "";
        let filledText = "";
        let resizedViewport = { width: 0, height: 0 };
        let waitedMs = 0;
        let customExecuted = false;

        const driver: CapturePageDriver = {
          setViewportSize: async (vp) => {
            resizedViewport = vp;
          },
          setExtraHTTPHeaders: async () => {},
          fill: async (sel, text) => {
            filledSelector = sel;
            filledText = text;
          },
          waitForTimeout: async (ms) => {
            waitedMs = ms;
          },
          goto: async () => {},
          waitForSelector: async () => {},
          screenshot: async () => Buffer.alloc(0),
          evaluate: async (script, payload) => {
            evaluatedCalls.push({ script, payload });
            return {} as never;
          },
        };

        await simulateDomEvent(driver, { type: "scroll", scrollDelta: { deltaX: 0, deltaY: 100 } });
        await simulateDomEvent(driver, { type: "focus", selector: "#input-el" });
        await simulateDomEvent(driver, { type: "focus" }); // no selector
        await simulateDomEvent(driver, { type: "blur", selector: "#input-el" });
        await simulateDomEvent(driver, { type: "blur" }); // no selector
        await simulateDomEvent(driver, { type: "input", selector: "#input-el", text: "Hello" });
        await simulateDomEvent(driver, { type: "input" }); // no selector
        await simulateDomEvent(driver, { type: "keydown", selector: "#input-el", key: "Enter" });
        await simulateDomEvent(driver, { type: "resize", viewport: { width: 375, height: 667 } });
        await simulateDomEvent(driver, { type: "resize" }); // no viewport
        await simulateDomEvent(driver, { type: "mediaQuery", mediaQuery: { query: "(prefers-color-scheme: dark)", matches: true } });
        await simulateDomEvent(driver, { type: "mediaQuery" }); // no mediaQuery
        await simulateDomEvent(driver, { type: "wait", delayMs: 250 });
        await simulateDomEvent(driver, { type: "wait" }); // default delayMs
        await simulateDomEvent(driver, {
          type: "custom",
          customAction: async () => {
            customExecuted = true;
          },
        });
        await simulateDomEvent(driver, { type: "custom" }); // no customAction

        expect(filledSelector).toBe("#input-el");
        expect(filledText).toBe("Hello");
        expect(resizedViewport).toEqual({ width: 375, height: 667 });
        expect(waitedMs).toBe(100);
        expect(customExecuted).toBe(true);
      });

      it("handles keypress and input when driver.fill is not available", async () => {
        const evaluatedCalls: unknown[] = [];
        const driverWithoutFill: CapturePageDriver = {
          setViewportSize: async () => {},
          setExtraHTTPHeaders: async () => {},
          goto: async () => {},
          waitForSelector: async () => {},
          screenshot: async () => Buffer.alloc(0),
          evaluate: async (script, payload) => {
            evaluatedCalls.push({ script, payload });
            return {} as never;
          },
        };

        await simulateDomEvent(driverWithoutFill, {
          type: "keypress",
          selector: "#box",
          text: "my-text",
          key: "a",
        });

        expect(evaluatedCalls).toHaveLength(1);
      });

      it("handles wait fallback when driver.waitForTimeout is not provided", async () => {
        const driver: CapturePageDriver = {
          setViewportSize: async () => {},
          setExtraHTTPHeaders: async () => {},
          goto: async () => {},
          waitForSelector: async () => {},
          screenshot: async () => Buffer.alloc(0),
          evaluate: async () => ({} as never),
        };

        const start = Date.now();
        await simulateDomEvent(driver, { type: "wait", delayMs: 20 });
        expect(Date.now() - start).toBeGreaterThanOrEqual(15);
      });
    });
  });

  describe("simulator runner", () => {
    it("executes complete simulation sequence with passing CLS and generates report", async () => {
      const snap: DomPhysicsSnapshot = {
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
        scrollPosition: { x: 0, y: 0 },
        elements: [createMockElement("#btn", "button")],
        layoutOverflows: [],
        textClippings: [],
        capturedAt: new Date().toISOString(),
      };

      const driver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        click: async () => {},
        waitForTimeout: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => snap as never,
      };

      const simulator = new DomEventSimulator({ settleDelayMs: 10 });
      const events: SyntheticDomEvent[] = [
        { type: "click", selector: "#btn" },
        { type: "wait", delayMs: 10 },
      ];

      const report = await simulator.executeSequence(driver, events, {
        settleDelayMs: 5,
        clsThreshold: 0.2,
        failOnUnexpectedShift: false,
      });
      expect(report.totalEvents).toBe(2);
      expect(report.successfulEvents).toBe(2);
      expect(report.failedEvents).toBe(0);
      expect(report.passed).toBe(true);
      expect(report.summary).toContain("DOM Event Simulation Passed");
    });

    it("settles with setTimeout when driver does not have waitForTimeout", async () => {
      const snap: DomPhysicsSnapshot = {
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
        scrollPosition: { x: 0, y: 0 },
        elements: [],
        layoutOverflows: [],
        textClippings: [],
        capturedAt: new Date().toISOString(),
      };

      const driverWithoutTimeout: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => snap as never,
      };

      const simulator = new DomEventSimulator({ settleDelayMs: 5 });
      const report = await simulator.executeSequence(driverWithoutTimeout, [{ type: "wait", delayMs: 5 }]);
      expect(report.successfulEvents).toBe(1);
    });

    it("captures execution errors during simulated events gracefully (Error and non-Error throws)", async () => {
      let failCount = 0;
      const driver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        click: async () => {
          failCount++;
          if (failCount === 1) {
            throw new Error("Element not interactable");
          }
          throw "Raw string failure";
        },
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => {
          return {
            viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
            scrollPosition: { x: 0, y: 0 },
            elements: [],
            layoutOverflows: [],
            textClippings: [],
            capturedAt: new Date().toISOString(),
          } as never;
        },
      };

      const simulator = new DomEventSimulator({ settleDelayMs: 0 });
      const report = await simulator.executeSequence(driver, [
        { type: "click", selector: "#broken-btn-1" },
        { type: "click", selector: "#broken-btn-2" },
      ]);

      expect(report.totalEvents).toBe(2);
      expect(report.successfulEvents).toBe(0);
      expect(report.failedEvents).toBe(2);
      expect(report.stepResults[0]?.error).toContain("Element not interactable");
      expect(report.stepResults[1]?.error).toBe("Raw string failure");
    });

    it("flags defects when unexpected layout shift occurs", async () => {
      let callCount = 0;
      const snap1: DomPhysicsSnapshot = {
        viewport: { width: 1000, height: 1000, deviceScaleFactor: 1 },
        scrollPosition: { x: 0, y: 0 },
        elements: [
          {
            selector: "#footer",
            tagName: "div",
            bounds: { x: 0, y: 500, width: 1000, height: 200, left: 0, right: 1000, top: 500, bottom: 700 },
            computedStyles: { display: "block", position: "static", zIndex: 0, color: "#000", backgroundColor: "#fff", overflowX: "visible", overflowY: "visible" },
            metrics: { scrollWidth: 1000, clientWidth: 1000, scrollHeight: 200, clientHeight: 200, offsetWidth: 1000, offsetHeight: 200 },
          },
        ],
        layoutOverflows: [],
        textClippings: [],
        capturedAt: new Date().toISOString(),
      };

      const snap2: DomPhysicsSnapshot = {
        viewport: { width: 1000, height: 1000, deviceScaleFactor: 1 },
        scrollPosition: { x: 0, y: 0 },
        elements: [
          {
            selector: "#footer",
            tagName: "div",
            bounds: { x: 0, y: 800, width: 1000, height: 200, left: 0, right: 1000, top: 800, bottom: 1000 },
            computedStyles: { display: "block", position: "static", zIndex: 0, color: "#000", backgroundColor: "#fff", overflowX: "visible", overflowY: "visible" },
            metrics: { scrollWidth: 1000, clientWidth: 1000, scrollHeight: 200, clientHeight: 200, offsetWidth: 1000, offsetHeight: 200 },
          },
        ],
        layoutOverflows: [],
        textClippings: [],
        capturedAt: new Date().toISOString(),
      };

      const driver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        click: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => {
          callCount++;
          return (callCount % 2 === 1 ? snap1 : snap2) as never;
        },
      };

      const simulator = new DomEventSimulator({
        failOnUnexpectedShift: true,
        settleDelayMs: 0,
        trackerOptions: { ignoreUserInputShifts: false },
      });
      const report = await simulator.executeSequence(driver, [
        { type: "click", selector: "#btn", expectedBehavior: "feedback_only" },
      ]);

      expect(report.unexpectedShifts.length).toBeGreaterThan(0);
      expect(report.passed).toBe(false);
      expect(report.summary).toContain("DOM Event Simulation Flagged Defects");
    });
  });
});
