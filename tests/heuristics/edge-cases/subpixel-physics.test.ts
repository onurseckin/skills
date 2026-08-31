/**
 * @file subpixel-physics.test.ts
 * Modular unit tests for Subpixel Physics, Transform Drift, and Multi-Viewport Matrix
 */

import { describe, expect, it } from "bun:test";
import {
  evaluateEdgeContrast,
  evaluateElementSubpixelPhysics,
  evaluateSubpixelDrift,
  validateElementSubpixelPhysics,
  validateSubpixelBorders,
  type SubpixelElementInput,
} from "../../../../olt/scripts/src/heuristics/subpixel-borders/index.ts";
import type { ElementPhysicsSnapshot } from "../../../../olt/scripts/src/capture/validator/types.ts";

describe("Extended Heuristics: Subpixel Physics & Viewport Variations", () => {
  it("verifies multi-viewport DPR variations (Desktop-wide @ 1x/2x, Mobile @ 3x Super Retina) on composite UI trees", () => {
    const desktop1xElements: readonly SubpixelElementInput[] = [
      {
        selector: "header.nav-bar",
        bounds: { x: 0, y: 0, width: 1920, height: 64 },
        borderWidth: { bottom: 1 },
      },
      {
        selector: "div.hero-card",
        bounds: { x: 240, y: 96, width: 1440, height: 480 },
        borderWidth: 2,
      },
      {
        selector: "div.blurry-card",
        bounds: { x: 240, y: 600, width: 400, height: 200 },
        borderWidth: 0.5,
      },
      {
        selector: "dialog.centered-modal",
        bounds: { x: 732.5, y: 300, width: 455, height: 300 },
        borderWidth: 1,
      },
    ];

    const desktop1xAnalysis = validateSubpixelBorders(
      desktop1xElements.map((el) => ({ ...el, dprScales: [1.0] })),
    );
    expect(desktop1xAnalysis.isCompliant).toBe(false);
    expect(desktop1xAnalysis.defects.some((d) => d.elementSelector === "div.blurry-card")).toBe(
      true,
    );
    expect(
      desktop1xAnalysis.defects.some((d) => d.elementSelector === "dialog.centered-modal"),
    ).toBe(true);

    const desktop2xElements: readonly SubpixelElementInput[] = [
      {
        selector: "header.nav-bar",
        bounds: { x: 0, y: 0, width: 2560, height: 80 },
        borderWidth: { bottom: 0.5 },
      },
      {
        selector: "div.retina-card",
        bounds: { x: 200, y: 120, width: 1000, height: 600 },
        borderWidth: 0.5,
      },
      {
        selector: "div.odd-centered-modal",
        bounds: { x: 500, y: 200, width: 350, height: 250 },
        borderWidth: 1.0,
        transform: "translate(-50%, -50%)",
      },
    ];

    const desktop2xAnalysis = validateSubpixelBorders(
      desktop2xElements.map((el) => ({ ...el, dprScales: [2.0] })),
    );
    expect(desktop2xAnalysis.isCompliant).toBe(true);
    expect(desktop2xAnalysis.defects.length).toBe(0);

    const mobile3xElements: readonly SubpixelElementInput[] = [
      {
        selector: "header.mobile-header",
        bounds: { x: 0, y: 0, width: 390, height: 44 },
        borderWidth: { bottom: 1 / 3 },
      },
      {
        selector: "span.pill-badge",
        bounds: { x: 16, y: 60, width: 80, height: 24 },
        borderWidth: 2 / 3,
      },
      {
        selector: "div.mobile-card",
        bounds: { x: 16, y: 100, width: 358, height: 200 },
        borderWidth: 1.0,
      },
      {
        selector: "div.flawed-mobile-card",
        bounds: { x: 16, y: 320, width: 358, height: 200 },
        borderWidth: 0.5,
      },
    ];

    const mobile3xAnalysis = validateSubpixelBorders(
      mobile3xElements.map((el) => ({ ...el, dprScales: [3.0] })),
    );
    expect(mobile3xAnalysis.isCompliant).toBe(false);
    expect(mobile3xAnalysis.defects.length).toBe(1);
    expect(mobile3xAnalysis.defects[0]?.elementSelector).toBe("div.flawed-mobile-card");
    expect(mobile3xAnalysis.defects[0]?.category).toBe("subpixel-hairline-blur");

    const universalComponent: SubpixelElementInput = {
      selector: "div.responsive-shell",
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      borderWidth: 1.0,
      dprScales: [1.0, 1.5, 2.0, 3.0],
    };

    const universalAnalysis = validateSubpixelBorders(universalComponent);
    expect(universalAnalysis.evaluatedDprs).toEqual([1.0, 1.5, 2.0, 3.0]);
    expect(universalAnalysis.worstCaseDpr).toBe(1.5);
    expect(universalAnalysis.maxRoundingErrorAcrossDprs).toBe(0.5);
    expect(universalAnalysis.dprEvaluations.length).toBe(4);
    expect(universalAnalysis.remediations.length).toBeGreaterThan(0);
  });

  it("evaluates subpixel drift across DPR scales with evaluateSubpixelDrift detecting fractional blur vs crisp rendering", () => {
    const drift05 = evaluateSubpixelDrift(0.5, [1.0, 1.5, 2.0, 3.0]);
    expect(drift05.cssWidth).toBe(0.5);
    expect(drift05.isCrispOnAllDprs).toBe(false);
    expect(drift05.crispDprs).toEqual([2.0]);
    expect(drift05.blurredDprs).toEqual([1.0, 1.5, 3.0]);
    expect(drift05.recommendedCssWidth).toBe(1.0);
    expect(drift05.worstCaseRoundingError).toBe(0.5);
    expect(drift05.defects.length).toBe(3);

    const drift033 = evaluateSubpixelDrift(1 / 3, [1.0, 2.0, 3.0]);
    expect(drift033.isCrispOnAllDprs).toBe(false);
    expect(drift033.crispDprs).toEqual([3.0]);
    expect(drift033.blurredDprs).toEqual([1.0, 2.0]);
    expect(drift033.recommendedCssWidth).toBe(1.0);

    const drift10 = evaluateSubpixelDrift(1.0, [1.0, 2.0, 3.0]);
    expect(drift10.isCrispOnAllDprs).toBe(true);
    expect(drift10.crispDprs).toEqual([1.0, 2.0, 3.0]);
    expect(drift10.blurredDprs).toEqual([]);
    expect(drift10.defects.length).toBe(0);

    const drift133 = evaluateSubpixelDrift(4 / 3, [1.0, 1.5, 2.0, 3.0]);
    expect(drift133.crispDprs).toEqual([1.5, 3.0]);
    expect(drift133.blurredDprs).toEqual([1.0, 2.0]);
  });

  it("evaluates edge contrast degradation and nominal vs effective contrast with evaluateEdgeContrast", () => {
    const crispContrast = evaluateEdgeContrast(1.0, 1.0, 4.5, 3.0);
    expect(crispContrast.isCrisp).toBe(true);
    expect(crispContrast.roundingError).toBe(0);
    expect(crispContrast.effectiveContrastRatio).toBe(4.5);
    expect(crispContrast.contrastDegradationPct).toBe(0);
    expect(crispContrast.passesContrastThreshold).toBe(true);

    const blurredContrast = evaluateEdgeContrast(0.5, 1.0, 4.5, 3.0);
    expect(blurredContrast.isCrisp).toBe(false);
    expect(blurredContrast.roundingError).toBe(0.5);
    expect(blurredContrast.effectiveContrastRatio).toBeLessThan(4.5);
    expect(blurredContrast.contrastDegradationPct).toBeGreaterThan(0);

    const retinaContrast = evaluateEdgeContrast(0.5, 2.0, 4.5, 3.0);
    expect(retinaContrast.isCrisp).toBe(true);
    expect(retinaContrast.roundingError).toBe(0);
    expect(retinaContrast.effectiveContrastRatio).toBe(4.5);
  });

  it("evaluates ElementPhysicsSnapshot bounds and transforms with validateElementSubpixelPhysics and evaluateElementSubpixelPhysics", () => {
    const cleanElement: ElementPhysicsSnapshot = {
      selector: "button.submit-btn",
      tagName: "BUTTON",
      bounds: { x: 100, y: 200, width: 120, height: 48 },
    };

    const cleanResult = validateElementSubpixelPhysics(cleanElement, 2.0);
    expect(cleanResult.isCompliant).toBe(true);
    expect(cleanResult.defects.length).toBe(0);

    const jitterElement: ElementPhysicsSnapshot = {
      selector: "div.jittery-box",
      tagName: "DIV",
      bounds: { x: 10.33, y: 20.67, width: 99.45, height: 49.88 },
      computedStyles: {
        transform: "translate(0.5px, 0.5px)",
      },
    };

    const jitterResult = evaluateElementSubpixelPhysics(jitterElement, 1.0);
    expect(jitterResult.isCompliant).toBe(false);
    expect(jitterResult.defects.length).toBeGreaterThan(0);
  });

  it("supports devicePixelRatio parameter and validation options in validateSubpixelBorders", () => {
    const singleDprInput: SubpixelElementInput = {
      selector: "header.app-bar",
      bounds: { x: 0, y: 0, width: 390, height: 50 },
      borderWidth: 1 / 3,
      devicePixelRatio: 3.0,
    };

    const singleResult = validateSubpixelBorders(singleDprInput);
    expect(singleResult.evaluatedDprs).toEqual([3.0]);
    expect(singleResult.isCompliant).toBe(true);

    const optionsResult = validateSubpixelBorders(
      {
        selector: "div.card",
        bounds: { x: 0, y: 0, width: 200, height: 100 },
        borderWidth: 0.5,
      },
      { devicePixelRatio: 2.0 },
    );
    expect(optionsResult.evaluatedDprs).toEqual([2.0]);
    expect(optionsResult.isCompliant).toBe(true);
  });
});
