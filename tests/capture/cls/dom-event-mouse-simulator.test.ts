import { describe, expect, it } from "bun:test";
import {
  buildSyntheticInteractionPlan,
  classifyLayoutShift,
  DEFAULT_DOM_SIMULATION_OPTIONS,
  resolveDomSimulationOptions,
  type DomSimulationOptions,
  type SyntheticDomEvent,
} from "../../../olt/scripts/src/capture/runners/dom-event-simulator/index.ts";
import {
  DEFAULT_LAYOUT_SHIFT_OPTIONS,
  type LayoutShiftEntry,
} from "../../../olt/scripts/src/capture/runners/layout-shift-tracker/index.ts";
import type { ExtractedElementPhysics } from "../../../olt/scripts/src/capture/runners/types.ts";

function createMockElement(
  selector: string,
  tagName: string,
  role?: string,
): ExtractedElementPhysics {
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

describe("dom-event-simulator: options, classification & mouse interaction plan", () => {
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

  describe("classifyLayoutShift", () => {
    it("returns isExpected true if shift score < 0.001 or sources empty", () => {
      const tinyShift = createMockShiftEntry(0.0005, 1);
      const event: SyntheticDomEvent = { type: "click", selector: "#btn" };
      expect(classifyLayoutShift(event, tinyShift, 0)).toEqual({ isExpected: true });

      const zeroSources = createMockShiftEntry(0.05, 0);
      expect(classifyLayoutShift(event, zeroSources, 0)).toEqual({ isExpected: true });
    });

    it("handles no_shift behavior across critical, moderate, and minor severities", () => {
      const eventWithSel: SyntheticDomEvent = {
        type: "hover",
        selector: "#card",
        expectedBehavior: "no_shift",
      };
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
      const noSelEvent: SyntheticDomEvent = {
        type: "click",
        expectedBehavior: "layout_expansion",
      };
      const shift = createMockShiftEntry(0.08, 1, [{ selector: "#modal" }]);
      expect(classifyLayoutShift(noSelEvent, shift, 0)).toEqual({ isExpected: true });

      const matchedEvent: SyntheticDomEvent = {
        type: "click",
        selector: "#accordion-item",
        expectedBehavior: "layout_expansion",
      };
      const matchedShift = createMockShiftEntry(0.08, 1, [{ selector: "#accordion-item-body" }]);
      expect(classifyLayoutShift(matchedEvent, matchedShift, 1)).toEqual({ isExpected: true });
    });

    it("handles feedback_only shifts > 0.01 as defects and <= 0.01 as expected", () => {
      const event: SyntheticDomEvent = {
        type: "click",
        selector: "#btn",
        expectedBehavior: "feedback_only",
      };
      const smallShift = createMockShiftEntry(0.005, 1);
      expect(classifyLayoutShift(event, smallShift, 0)).toEqual({ isExpected: true });

      const critShift = createMockShiftEntry(0.2, 5);
      const critRes = classifyLayoutShift(event, critShift, 1);
      expect(critRes.isExpected).toBe(false);
      expect(critRes.defect?.severity).toBe("critical");
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

      const plan = buildSyntheticInteractionPlan(
        [button, roleButton, input, textarea, textbox, staticDiv],
        { width: 1440, height: 900 },
      );

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
