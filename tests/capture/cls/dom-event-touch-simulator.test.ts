import { describe, expect, it } from "bun:test";
import {
  DomEventSimulator,
  simulateDomEvent,
  type SyntheticDomEvent,
} from "../../../olt/scripts/src/capture/runners/dom-event-simulator/index.ts";
import type {
  CapturePageDriver,
  DomPhysicsSnapshot,
} from "../../../olt/scripts/src/capture/runners/types.ts";

describe("dom-event-simulator: touch & stateful simulator runner", () => {
  describe("simulateDomEvent handlers", () => {
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

      await simulateDomEvent(driverWithoutClick, { type: "click" });
    });

    it("dispatches scroll, focus, blur, keypress, resize, mediaQuery, wait, and custom", async () => {
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
        evaluate: async () => ({}) as never,
      };

      await simulateDomEvent(driver, { type: "scroll", scrollDelta: { deltaX: 0, deltaY: 100 } });
      await simulateDomEvent(driver, { type: "focus", selector: "#input-el" });
      await simulateDomEvent(driver, { type: "focus" });
      await simulateDomEvent(driver, { type: "blur", selector: "#input-el" });
      await simulateDomEvent(driver, { type: "blur" });
      await simulateDomEvent(driver, { type: "input", selector: "#input-el", text: "Hello" });
      await simulateDomEvent(driver, { type: "input" });
      await simulateDomEvent(driver, { type: "keydown", selector: "#input-el", key: "Enter" });
      await simulateDomEvent(driver, { type: "resize", viewport: { width: 375, height: 667 } });
      await simulateDomEvent(driver, { type: "resize" });
      await simulateDomEvent(driver, {
        type: "mediaQuery",
        mediaQuery: { query: "(prefers-color-scheme: dark)", matches: true },
      });
      await simulateDomEvent(driver, { type: "mediaQuery" });
      await simulateDomEvent(driver, { type: "wait", delayMs: 250 });
      await simulateDomEvent(driver, { type: "wait" });
      await simulateDomEvent(driver, {
        type: "custom",
        customAction: async () => {
          customExecuted = true;
        },
      });
      await simulateDomEvent(driver, { type: "custom" });

      expect(filledSelector).toBe("#input-el");
      expect(filledText).toBe("Hello");
      expect(resizedViewport).toEqual({ width: 375, height: 667 });
      expect(waitedMs).toBe(100);
      expect(customExecuted).toBe(true);
    });

    it("handles keypress when driver.fill is not available and wait without waitForTimeout", async () => {
      const driverWithoutFill: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(0),
        evaluate: async () => ({}) as never,
      };

      await simulateDomEvent(driverWithoutFill, {
        type: "keypress",
        selector: "#box",
        text: "my-text",
        key: "a",
      });

      const start = Date.now();
      await simulateDomEvent(driverWithoutFill, { type: "wait", delayMs: 20 });
      expect(Date.now() - start).toBeGreaterThanOrEqual(15);
    });
  });

  describe("simulator runner", () => {
    it("executes complete simulation sequence with passing CLS and generates report", async () => {
      const snap: DomPhysicsSnapshot = {
        viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
        scrollPosition: { x: 0, y: 0 },
        elements: [],
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
      const report = await simulator.executeSequence(driverWithoutTimeout, [
        { type: "wait", delayMs: 5 },
      ]);
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
  });
});
