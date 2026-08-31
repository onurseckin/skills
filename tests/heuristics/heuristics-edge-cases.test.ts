/**
 * @file heuristics-edge-cases.test.ts
 * Comprehensive Test Suite for Extended Edge-Case Heuristics Engine
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeGlassSurfaces,
  calculateApcaLightnessContrast,
  calculateEffectiveCumulativeBlur,
  compositeRgba,
  extractBlurRadiusPx,
  getRequiredApcaLc,
  parseColorToRgba,
  simulateSubstrateContrasts,
  sRgbToLuminanceY,
  type GlassSurfaceLayer,
  type GlassTextElement,
  type ParsedRgba,
} from "../../olt/scripts/src/heuristics/glass-surfaces/index.ts";
import {
  validateModalFocusTrap,
  type ModalFocusTrapInput,
} from "../../olt/scripts/src/heuristics/modal-focus-traps/index.ts";
import {
  evaluateAntiAliasingEdgeContrast,
  evaluateEdgeContrast,
  evaluateElementSubpixelPhysics,
  evaluateSubpixelDrift,
  getPhysicalRoundingError,
  normalizeBorderWidths,
  parseTransformTranslations,
  snapToDevicePixels,
  validateElementSubpixelPhysics,
  validateSubpixelBorders,
  type SubpixelElementBounds,
  type SubpixelElementInput,
} from "../../olt/scripts/src/heuristics/subpixel-borders/index.ts";
import {
  auditCriterionSemanticDepth,
  auditManifestSemanticDepth,
  auditSingleViewportManifest,
  CANONICAL_VIEWPORTS,
  CANONICAL_VIEWPORT_SPECS,
  computePhysicalViewportMetrics,
  normalizePillar,
  synthesizeDprAwareCompanionManifest,
  verifyMultiViewportManifests,
  type MultiViewportBundleInput,
  type ScreenshotArtifact,
} from "../../olt/scripts/src/heuristics/multi-viewport-manifest/index.ts";
import {
  evaluateCognitiveQuestions,
  validateCognitiveSemanticDepth,
} from "../../olt/scripts/src/capture/validator/cognitive/cognitive-questions/index.ts";
import type {
  CompanionManifestV2,
  ElementPhysicsSnapshot,
  EvaluatedCriterion,
  ValidationContext,
} from "../../olt/scripts/src/capture/validator/types.ts";

describe("Extended Heuristics: Nested Glass Surfaces & Translucency Dynamics", () => {
  it("parses diverse color formats accurately (hex3, hex4, hex6, hex8, rgb, rgba with %, hsla, named, malformed)", () => {
    expect(parseColorToRgba("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColorToRgba("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColorToRgba("#ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
    expect(parseColorToRgba("#1234")).toEqual({ r: 17, g: 34, b: 51, a: 68 / 255 });
    expect(parseColorToRgba("rgba(100, 150, 200, 0.5)")).toEqual({
      r: 100,
      g: 150,
      b: 200,
      a: 0.5,
    });
    expect(parseColorToRgba("rgba(100%, 50%, 0%, 0.8)")).toEqual({ r: 255, g: 128, b: 0, a: 0.8 });
    expect(parseColorToRgba("rgb(50, 60, 70)")).toEqual({ r: 50, g: 60, b: 70, a: 1 });
    expect(parseColorToRgba("hsla(0, 100%, 50%, 0.8)")?.r).toBe(255);
    expect(parseColorToRgba("hsla(120deg, 100%, 50%, 0.5)")?.g).toBe(255);
    expect(parseColorToRgba("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColorToRgba("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColorToRgba("black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColorToRgba("invalid-color")).toBeNull();
    expect(parseColorToRgba("")).toBeNull();
    expect(parseColorToRgba(undefined)).toBeNull();
  });

  it("extracts blur radius across px, rem, and em units and compound filters", () => {
    expect(extractBlurRadiusPx("blur(12px)")).toBe(12);
    expect(extractBlurRadiusPx("blur(1.5rem)")).toBe(24);
    expect(extractBlurRadiusPx("blur(2em)")).toBe(32);
    expect(extractBlurRadiusPx("saturate(180%) blur(16px)")).toBe(16);
    expect(extractBlurRadiusPx("blur(0px)")).toBe(0);
    expect(extractBlurRadiusPx("none")).toBe(0);
    expect(extractBlurRadiusPx(undefined)).toBe(0);
  });

  it("composites translucent layers over background correctly using Porter-Duff Over", () => {
    const fg = { r: 255, g: 255, b: 255, a: 0.5 };
    const bg = { r: 0, g: 0, b: 0, a: 1 };
    const comp = compositeRgba(fg, bg);
    expect(comp.r).toBe(128);
    expect(comp.g).toBe(128);
    expect(comp.b).toBe(128);
    expect(comp.a).toBe(1);

    const transparentComp = compositeRgba({ r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 0 });
    expect(transparentComp.a).toBe(0);
  });

  it("validates high-contrast compliant text over nested glass stack", () => {
    const stack: GlassSurfaceLayer[] = [
      {
        selector: ".glass-card",
        backgroundColor: "rgba(255, 255, 255, 0.85)",
        backdropFilter: "blur(16px)",
      },
      {
        selector: ".glass-badge",
        backgroundColor: "rgba(255, 255, 255, 0.9)",
        backdropFilter: "blur(8px)",
      },
    ];

    const text: GlassTextElement = {
      selector: ".heading",
      text: "Certified Dashboard",
      color: "#0f172a",
      fontSize: 24,
      fontWeight: 700,
    };

    const result = analyzeGlassSurfaces(stack, text);
    expect(result.isCompliant).toBe(true);
    expect(result.layerCount).toBe(2);
    expect(result.cumulativeBlurPx).toBeGreaterThan(15);
    expect(result.defects.length).toBe(0);
    expect(result.substrates.light.passed).toBe(true);
    expect(result.substrates.dark.passed).toBe(true);
    expect(result.worstCaseLc).toBeGreaterThanOrEqual(result.requiredLc);
  });

  it("flags excessive glass layer stacking (> 3 layers)", () => {
    const stack: GlassSurfaceLayer[] = [
      { selector: ".l1", backgroundColor: "rgba(255,255,255,0.3)", backdropFilter: "blur(4px)" },
      { selector: ".l2", backgroundColor: "rgba(255,255,255,0.3)", backdropFilter: "blur(4px)" },
      { selector: ".l3", backgroundColor: "rgba(255,255,255,0.3)", backdropFilter: "blur(4px)" },
      { selector: ".l4", backgroundColor: "rgba(255,255,255,0.3)", backdropFilter: "blur(4px)" },
    ];

    const result = analyzeGlassSurfaces(stack);
    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "glass-blur-overdraw")).toBe(true);
  });

  it("evaluates 5+ deeply nested translucent glass layers without numerical errors or NaN", () => {
    const deepStack: GlassSurfaceLayer[] = [
      {
        selector: ".modal-backdrop",
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(20px)",
      },
      {
        selector: ".modal-window",
        backgroundColor: "rgba(255, 255, 255, 0.6)",
        backdropFilter: "blur(12px)",
      },
      {
        selector: ".modal-section",
        backgroundColor: "rgba(255, 255, 255, 0.4)",
        backdropFilter: "blur(8px)",
      },
      {
        selector: ".glass-pill",
        backgroundColor: "rgba(0, 0, 0, 0.2)",
        backdropFilter: "blur(4px)",
      },
      {
        selector: ".glass-badge",
        backgroundColor: "rgba(255, 255, 255, 0.8)",
        backdropFilter: "blur(2px)",
      },
    ];

    const text: GlassTextElement = {
      selector: ".badge-text",
      text: "VIP Access",
      color: "#000000",
      fontSize: 12,
      fontWeight: 600,
    };

    const result = analyzeGlassSurfaces(deepStack, text);
    expect(result.layerCount).toBe(5);
    expect(isNaN(result.cumulativeBlurPx)).toBe(false);
    expect(isNaN(result.effectiveLayerOpacity)).toBe(false);
    expect(isNaN(result.worstCaseLc)).toBe(false);
    expect(result.defects.some((d) => d.category === "glass-blur-overdraw")).toBe(true);
  });

  it("flags transparency washout when effective accumulated opacity is under 15%", () => {
    const stack: GlassSurfaceLayer[] = [
      {
        selector: ".ultra-thin-glass",
        backgroundColor: "rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(10px)",
      },
    ];

    const result = analyzeGlassSurfaces(stack);
    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "glass-transparency-washout")).toBe(true);
  });

  it("passes opacity threshold when accumulated opacity is exactly or above 15%", () => {
    const stack: GlassSurfaceLayer[] = [
      {
        selector: ".acceptable-glass",
        backgroundColor: "rgba(255, 255, 255, 0.16)",
        backdropFilter: "blur(10px)",
      },
    ];

    const result = analyzeGlassSurfaces(stack);
    expect(result.effectiveLayerOpacity).toBeGreaterThanOrEqual(0.15);
    expect(result.defects.some((d) => d.category === "glass-transparency-washout")).toBe(false);
  });

  it("flags APCA contrast defect when text contrast fails on dark or light substrate", () => {
    const stack: GlassSurfaceLayer[] = [
      {
        selector: ".translucent-modal",
        backgroundColor: "rgba(255, 255, 255, 0.4)",
        backdropFilter: "blur(12px)",
      },
    ];

    // White text on 40% white glass will fail on white substrate
    const text: GlassTextElement = {
      selector: ".white-label",
      text: "Subhead Label",
      color: "#ffffff",
      fontSize: 14,
      fontWeight: 400,
    };

    const result = analyzeGlassSurfaces(stack, text);
    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "glass-apca-contrast")).toBe(true);
  });

  it("scales required APCA Lc thresholds based on font size and font weight tiers", () => {
    expect(getRequiredApcaLc(12, 400)).toBe(90); // Small body
    expect(getRequiredApcaLc(14, 600)).toBe(90); // Small bold
    expect(getRequiredApcaLc(16, 400)).toBe(75); // Standard body
    expect(getRequiredApcaLc(18, 400)).toBe(75); // Medium body regular
    expect(getRequiredApcaLc(18, 700)).toBe(60); // Medium body bold
    expect(getRequiredApcaLc(24, 400)).toBe(60); // Display large
    expect(getRequiredApcaLc(36, 700)).toBe(60); // Large title bold
  });

  it("detects luminance clash dead-zone (|Y_text - Y_bg| < 0.05) causing edge vibration", () => {
    const stack: GlassSurfaceLayer[] = [
      {
        selector: ".gray-glass",
        backgroundColor: "rgba(128, 128, 128, 0.9)",
        backdropFilter: "blur(8px)",
      },
    ];

    // Text color with almost identical luminance to gray substrate
    const text: GlassTextElement = {
      selector: ".mid-gray-text",
      text: "Vibrating text label",
      color: "#808080",
      fontSize: 16,
      fontWeight: 400,
    };

    const result = analyzeGlassSurfaces(stack, text);
    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "glass-luminosity-clash")).toBe(true);
  });

  it("calculates effective cumulative blur and simulates multiple custom substrates", () => {
    const blurs = [8, 12, 16];
    const blurCalc = calculateEffectiveCumulativeBlur(blurs);
    expect(blurCalc.linearSumPx).toBe(36);
    expect(blurCalc.quadraticCumulativePx).toBeCloseTo(Math.sqrt(64 + 144 + 256), 1);

    const stack: GlassSurfaceLayer[] = [
      { selector: ".g1", backgroundColor: "rgba(0, 0, 0, 0.8)", backdropFilter: "blur(10px)" },
    ];
    const text: GlassTextElement = {
      selector: ".header",
      color: "#ffffff",
      fontSize: 24,
      fontWeight: 700,
    };

    const customSubstrates: readonly ParsedRgba[] = [
      { r: 255, g: 255, b: 255, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 128, g: 128, b: 128, a: 1 },
    ];

    const sim = simulateSubstrateContrasts(stack, text, customSubstrates);
    expect(sim.length).toBe(3);
    expect(sim.every((s) => s.passed)).toBe(true);
  });

  it("flags translucent surface missing backdrop blur", () => {
    const stack: GlassSurfaceLayer[] = [
      {
        selector: ".no-blur-glass",
        backgroundColor: "rgba(255, 255, 255, 0.5)",
      },
    ];

    const result = analyzeGlassSurfaces(stack);
    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "glass-missing-blur")).toBe(true);
  });

  it("handles extreme alphas (0.001, 0.05, 0.999) without NaN in APCA or sRGB luminance", () => {
    const extremeColors = [
      { r: 255, g: 255, b: 255, a: 0.001 },
      { r: 0, g: 0, b: 0, a: 0.05 },
      { r: 255, g: 0, b: 0, a: 0.999 },
    ];

    for (const c of extremeColors) {
      const lum = sRgbToLuminanceY(c);
      expect(isNaN(lum)).toBe(false);
      expect(lum).toBeGreaterThanOrEqual(0);

      const lc = calculateApcaLightnessContrast(c, { r: 255, g: 255, b: 255, a: 1 });
      expect(isNaN(lc)).toBe(false);
    }
  });
});

describe("Extended Heuristics: Modal Focus Traps", () => {
  it("certifies a correctly configured and trapped modal dialog", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#auth-dialog",
      isOpen: true,
      role: "dialog",
      ariaModal: true,
      focusableElements: [
        { selector: "#email-input", tabIndex: 0, isInsideModal: true },
        { selector: "#password-input", tabIndex: 0, isInsideModal: true },
        { selector: "#submit-btn", tabIndex: 0, isInsideModal: true },
        { selector: "#close-btn", tabIndex: 0, isInsideModal: true },
      ],
      outsideSiblings: [
        { selector: "#app-header", ariaHidden: true },
        { selector: "#main-content", isInert: true },
      ],
      bodyStyles: {
        overflow: "hidden",
        position: "fixed",
        touchAction: "none",
        isScrollLocked: true,
      },
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(true);
    expect(result.isContained).toBe(true);
    expect(result.ariaHiddenInertCompliant).toBe(true);
    expect(result.scrollLockCompliant).toBe(true);
    expect(result.defects.length).toBe(0);
  });

  it("flags modal when focus escapes to outside element during Tab transition", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#bad-modal",
      isOpen: true,
      role: "dialog",
      ariaModal: true,
      focusableElements: [
        { selector: "#btn-1", tabIndex: 0, isInsideModal: true },
        { selector: "#btn-2", tabIndex: 0, isInsideModal: true },
      ],
      customTransitions: [
        {
          fromSelector: "#btn-2",
          toSelector: "#header-nav-link",
          key: "Tab",
          targetIsInsideModal: false,
        },
      ],
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(false);
    expect(result.isContained).toBe(false);
    expect(result.defects.some((d) => d.category === "modal-focus-escaped")).toBe(true);
  });

  it("flags modal with self aria-hidden or inert attributes", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#broken-dialog",
      isOpen: true,
      ariaModal: true,
      ariaHidden: true,
      focusableElements: [{ selector: "#btn-ok", tabIndex: 0, isInsideModal: true }],
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(false);
    expect(result.defects.some((d) => d.category === "modal-self-aria-hidden")).toBe(true);
  });

  it("flags modal with 0 active focusable elements", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#empty-dialog",
      isOpen: true,
      ariaModal: true,
      focusableElements: [{ selector: "#disabled-btn", disabled: true }],
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(false);
    expect(result.defects.some((d) => d.category === "modal-zero-focusable")).toBe(true);
  });

  it("flags unshielded outside siblings and body scroll-lock leakage", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#dialog",
      isOpen: true,
      ariaModal: true,
      focusableElements: [{ selector: "#btn-save", tabIndex: 0, isInsideModal: true }],
      outsideSiblings: [{ selector: "#sidebar", ariaHidden: false, isInert: false }],
      bodyStyles: {
        overflow: "visible",
      },
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(false);
    expect(result.ariaHiddenInertCompliant).toBe(false);
    expect(result.scrollLockCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "modal-aria-hidden-leak")).toBe(true);
    expect(result.defects.some((d) => d.category === "modal-scroll-leakage")).toBe(true);
  });

  it("skips verification gracefully when modal is closed", () => {
    const input: ModalFocusTrapInput = {
      modalSelector: "#closed-dialog",
      isOpen: false,
      focusableElements: [],
    };

    const result = validateModalFocusTrap(input);
    expect(result.passed).toBe(true);
    expect(result.defects.length).toBe(0);
  });
});

describe("Extended Heuristics: Subpixel Borders & Hairline Artifacts", () => {
  it("verifies integer aligned borders across fractional DPR scales", () => {
    // 2px border cleanly aligns at 1.0, 1.5, 2.0, 2.5, 3.0 DPR (2*1.5=3, 2*2.5=5)
    const result = validateSubpixelBorders({
      selector: ".aligned-box",
      bounds: { x: 100, y: 100, width: 200, height: 100 },
      borderWidth: 2,
      dprScales: [1.0, 1.5, 2.0, 2.5, 3.0],
    });

    expect(result.isCompliant).toBe(true);
    expect(result.defects.length).toBe(0);
  });

  it("detects fractional physical border rasterization error at 1.25x and 1.75x DPR", () => {
    const result = validateSubpixelBorders({
      selector: ".hairline-card",
      bounds: { x: 10, y: 10, width: 100, height: 50 },
      borderWidth: 1, // 1 * 1.25 = 1.25 physical px (error 0.25)
      dprScales: [1.25, 1.75, 2.25],
    });

    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "subpixel-hairline-blur")).toBe(true);
    expect(result.remediations.length).toBeGreaterThan(0);
  });

  it("detects transform translation subpixel smearing", () => {
    const result = validateSubpixelBorders({
      selector: ".centered-popup",
      bounds: { x: 50, y: 50, width: 25, height: 25 },
      borderWidth: 1,
      transform: "translate(-50%, -50%)", // -12.5px translation shifts to 37.5px
      dprScales: [1.0, 2.0],
    });

    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "subpixel-transform-smear")).toBe(true);
  });

  it("calculates physical rounding errors and parses complex transforms", () => {
    expect(getPhysicalRoundingError(1.5, 1.5)).toBe(0.25); // 2.25 - 2 = 0.25
    expect(getPhysicalRoundingError(2.0, 1.5)).toBe(0); // 3.0 - 3 = 0

    const trans = parseTransformTranslations("matrix(1, 0, 0, 1, 15.5, 20.25)");
    expect(trans.x).toBe(15.5);
    expect(trans.y).toBe(20.25);

    const norm = normalizeBorderWidths(1);
    expect(norm).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
  });

  it("evaluates snapToDevicePixels scalar and coordinate snapping across 1x, 1.5x, 2x, and 3x DPR scales", () => {
    // 1.0x DPR (Standard display)
    expect(snapToDevicePixels(0.5, 1.0)).toBe(1.0);
    expect(snapToDevicePixels(0.2, 1.0)).toBe(0.0);
    expect(snapToDevicePixels(10.6, 1.0)).toBe(11.0);
    expect(snapToDevicePixels(10.4, 1.0)).toBe(10.0);

    // 1.5x DPR (150% fractional scaling)
    expect(snapToDevicePixels(0.3333, 1.5)).toBeCloseTo(0, 4);
    expect(snapToDevicePixels(0.6667, 1.5)).toBeCloseTo(2 / 3, 3);
    expect(snapToDevicePixels(1.3333, 1.5)).toBeCloseTo(4 / 3, 3);
    expect(snapToDevicePixels(2.0, 1.5)).toBe(2.0);

    // 2.0x DPR (Retina)
    expect(snapToDevicePixels(0.25, 2.0)).toBe(0.5);
    expect(snapToDevicePixels(0.5, 2.0)).toBe(0.5);
    expect(snapToDevicePixels(0.75, 2.0)).toBe(1.0);
    expect(snapToDevicePixels(12.25, 2.0)).toBe(12.5);
    expect(snapToDevicePixels(12.5, 2.0)).toBe(12.5);

    // 3.0x DPR (Super Retina Mobile)
    expect(snapToDevicePixels(0.1667, 3.0)).toBeCloseTo(1 / 3, 3);
    expect(snapToDevicePixels(0.3333, 3.0)).toBeCloseTo(1 / 3, 3);
    expect(snapToDevicePixels(0.6667, 3.0)).toBeCloseTo(2 / 3, 3);
    expect(snapToDevicePixels(1.0, 3.0)).toBe(1.0);
    expect(snapToDevicePixels(1.3333, 3.0)).toBeCloseTo(4 / 3, 3);

    // Degenerate DPR fallback
    expect(snapToDevicePixels(15.75, 0)).toBe(15.75);
    expect(snapToDevicePixels(15.75, -2)).toBe(15.75);

    // SubpixelElementBounds snapping at 2.0x DPR
    const rawBounds2x: SubpixelElementBounds = { x: 10.25, y: 20.75, width: 100.33, height: 50.66 };
    const snappedBounds2x = snapToDevicePixels(rawBounds2x, 2.0);
    expect(snappedBounds2x).toEqual({ x: 10.5, y: 21.0, width: 100.5, height: 50.5 });

    // SubpixelElementBounds snapping at 3.0x DPR
    const rawBounds3x: SubpixelElementBounds = { x: 10.1, y: 20.2, width: 100.1, height: 50.2 };
    const snappedBounds3x = snapToDevicePixels(rawBounds3x, 3.0);
    expect(snappedBounds3x.x).toBe(10.0);
    expect(snappedBounds3x.y).toBeCloseTo(61 / 3, 3);
    expect(snappedBounds3x.width).toBe(100.0);
    expect(snappedBounds3x.height).toBeCloseTo(151 / 3, 3);
  });

  it("evaluates fractional CSS border widths (0.5px, 0.75px, 1.33px) detecting blurry vs crisp borders across DPR scales", () => {
    // 0.5px border: blurry at 1x, 1.5x, 3x; crisp at 2x (Retina)
    const border05 = validateSubpixelBorders({
      selector: ".hairline-05",
      bounds: { x: 0, y: 0, width: 120, height: 60 },
      borderWidth: 0.5,
      dprScales: [1.0, 1.5, 2.0, 3.0],
    });

    expect(border05.isCompliant).toBe(false);
    expect(border05.dprEvaluations[0]?.isAligned).toBe(false); // 1.0x: 0.5px phys (blurry)
    expect(border05.dprEvaluations[1]?.isAligned).toBe(false); // 1.5x: 0.75px phys (blurry)
    expect(border05.dprEvaluations[2]?.isAligned).toBe(true); // 2.0x: 1.0px phys (crisp)
    expect(border05.dprEvaluations[3]?.isAligned).toBe(false); // 3.0x: 1.5px phys (blurry)

    // 0.75px border: blurry at 1x, 1.5x, 2x, 3x; crisp at 4x
    const border075 = validateSubpixelBorders({
      selector: ".border-075",
      bounds: { x: 0, y: 0, width: 120, height: 60 },
      borderWidth: 0.75,
      dprScales: [1.0, 1.5, 2.0, 3.0, 4.0],
    });

    expect(border075.dprEvaluations[0]?.isAligned).toBe(false); // 1.0x: 0.75 phys
    expect(border075.dprEvaluations[1]?.isAligned).toBe(false); // 1.5x: 1.125 phys
    expect(border075.dprEvaluations[2]?.isAligned).toBe(false); // 2.0x: 1.5 phys
    expect(border075.dprEvaluations[3]?.isAligned).toBe(false); // 3.0x: 2.25 phys
    expect(border075.dprEvaluations[4]?.isAligned).toBe(true); // 4.0x: 3.0 phys (crisp)

    // 1.3333px (4/3 px) border: crisp at 1.5x and 3.0x; blurry at 1.0x and 2.0x
    const border133 = validateSubpixelBorders({
      selector: ".border-133",
      bounds: { x: 0, y: 0, width: 120, height: 60 },
      borderWidth: 4 / 3,
      dprScales: [1.0, 1.5, 2.0, 3.0],
    });

    expect(border133.dprEvaluations[0]?.isAligned).toBe(false); // 1.0x: 1.33 phys (blurry)
    expect(border133.dprEvaluations[1]?.isAligned).toBe(true); // 1.5x: 2.0 phys (crisp)
    expect(border133.dprEvaluations[2]?.isAligned).toBe(false); // 2.0x: 2.67 phys (blurry)
    expect(border133.dprEvaluations[3]?.isAligned).toBe(true); // 3.0x: 4.0 phys (crisp)

    // 0.3333px (1/3 px) hairline: crisp at 3.0x (Super Retina); blurry at 1.0x and 2.0x
    const border033 = validateSubpixelBorders({
      selector: ".hairline-retina-033",
      bounds: { x: 0, y: 0, width: 120, height: 60 },
      borderWidth: 1 / 3,
      dprScales: [1.0, 2.0, 3.0],
    });

    expect(border033.dprEvaluations[0]?.isAligned).toBe(false); // 1.0x: 0.33 phys (blurry)
    expect(border033.dprEvaluations[1]?.isAligned).toBe(false); // 2.0x: 0.67 phys (blurry)
    expect(border033.dprEvaluations[2]?.isAligned).toBe(true); // 3.0x: 1.0 phys (crisp)
  });

  it("evaluates asymmetric fractional CSS border widths across diverse DPR values", () => {
    const asymmetricInput: SubpixelElementInput = {
      selector: ".card-asymmetric",
      bounds: { x: 20, y: 20, width: 240, height: 160 },
      borderWidth: { top: 0.5, right: 1.0, bottom: 0.5, left: 1.0 },
      dprScales: [1.0, 2.0],
    };

    // At 2.0x DPR: top=1.0px, right=2.0px, bottom=1.0px, left=2.0px (all integer physical pixels)
    const result2x = validateSubpixelBorders({ ...asymmetricInput, dprScales: [2.0] });
    expect(result2x.isCompliant).toBe(true);
    expect(result2x.defects.length).toBe(0);

    // At 1.0x DPR: top=0.5px (blurry), right=1.0px (crisp), bottom=0.5px (blurry), left=1.0px (crisp)
    const result1x = validateSubpixelBorders({ ...asymmetricInput, dprScales: [1.0] });
    expect(result1x.isCompliant).toBe(false);
    expect(result1x.defects.some((d) => d.category === "subpixel-hairline-blur")).toBe(true);
  });

  it("verifies anti-aliasing edge contrast, fractional coverage, and hairline attenuation with evaluateAntiAliasingEdgeContrast", () => {
    // Sub-1px physical width: 0.5px at 1.0x DPR -> physicalWidth 0.5, edgeContrastFactor 0.5 (hairline fading defect)
    const contrast05_1x = evaluateAntiAliasingEdgeContrast(0.5, 1.0, ".sub-pixel-hairline");
    expect(contrast05_1x.isCrisp).toBe(false);
    expect(contrast05_1x.physicalWidth).toBe(0.5);
    expect(contrast05_1x.edgeContrastFactor).toBe(0.5);
    expect(contrast05_1x.roundingError).toBe(0.5);
    expect(contrast05_1x.defect).toBeDefined();
    expect(contrast05_1x.defect?.severity).toBe("moderate");

    // 0.5px at 2.0x DPR (Retina) -> physicalWidth 1.0, edgeContrastFactor 1.0 (crisp edge)
    const contrast05_2x = evaluateAntiAliasingEdgeContrast(0.5, 2.0, ".sub-pixel-hairline");
    expect(contrast05_2x.isCrisp).toBe(true);
    expect(contrast05_2x.physicalWidth).toBe(1.0);
    expect(contrast05_2x.edgeContrastFactor).toBe(1.0);
    expect(contrast05_2x.roundingError).toBe(0.0);
    expect(contrast05_2x.defect).toBeUndefined();

    // 1/3 px at 3.0x DPR (Super Retina) -> physicalWidth 1.0, edgeContrastFactor 1.0 (crisp edge)
    const contrast033_3x = evaluateAntiAliasingEdgeContrast(1 / 3, 3.0, ".retina-hairline");
    expect(contrast033_3x.isCrisp).toBe(true);
    expect(contrast033_3x.physicalWidth).toBe(1.0);
    expect(contrast033_3x.edgeContrastFactor).toBe(1.0);
    expect(contrast033_3x.roundingError).toBe(0.0);

    // 0.25px at 1.0x DPR -> physicalWidth 0.25, edgeContrastFactor 0.25
    const contrast025_1x = evaluateAntiAliasingEdgeContrast(0.25, 1.0);
    expect(contrast025_1x.isCrisp).toBe(false);
    expect(contrast025_1x.physicalWidth).toBe(0.25);
    expect(contrast025_1x.edgeContrastFactor).toBe(0.25);

    // 1.5px at 1.0x DPR -> physicalWidth 1.5, roundingError 0.5, edgeContrastFactor 0.75
    const contrast15_1x = evaluateAntiAliasingEdgeContrast(1.5, 1.0);
    expect(contrast15_1x.isCrisp).toBe(false);
    expect(contrast15_1x.physicalWidth).toBe(1.5);
    expect(contrast15_1x.roundingError).toBe(0.5);
    expect(contrast15_1x.edgeContrastFactor).toBe(0.75);
    expect(contrast15_1x.defect?.severity).toBe("minor");

    // 0px border -> edgeContrastFactor 0, isCrisp true
    const contrast0 = evaluateAntiAliasingEdgeContrast(0, 2.0);
    expect(contrast0.isCrisp).toBe(true);
    expect(contrast0.edgeContrastFactor).toBe(0);
    expect(contrast0.defect).toBeUndefined();
  });

  it("verifies multi-viewport DPR variations (Desktop-wide @ 1x/2x, Mobile @ 3x Super Retina) on composite UI trees", () => {
    // Scenario A: Desktop-wide standard DPI (1920x1080 @ 1.0x DPR)
    const desktop1xElements: readonly SubpixelElementInput[] = [
      {
        selector: "header.nav-bar",
        bounds: { x: 0, y: 0, width: 1920, height: 64 },
        borderWidth: { bottom: 1 }, // 1px border is crisp at 1.0x
      },
      {
        selector: "div.hero-card",
        bounds: { x: 240, y: 96, width: 1440, height: 480 },
        borderWidth: 2, // 2px border is crisp at 1.0x
      },
      {
        selector: "div.blurry-card",
        bounds: { x: 240, y: 600, width: 400, height: 200 },
        borderWidth: 0.5, // 0.5px hairline blurs at 1.0x
      },
      {
        selector: "dialog.centered-modal",
        bounds: { x: 732.5, y: 300, width: 455, height: 300 }, // Centered offset 732.5px blurs at 1.0x
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

    // Scenario B: Desktop-wide Retina (2560x1440 @ 2.0x DPR)
    const desktop2xElements: readonly SubpixelElementInput[] = [
      {
        selector: "header.nav-bar",
        bounds: { x: 0, y: 0, width: 2560, height: 80 },
        borderWidth: { bottom: 0.5 }, // 0.5px hairline resolves to 1.0 physical pixel at 2.0x (crisp!)
      },
      {
        selector: "div.retina-card",
        bounds: { x: 200, y: 120, width: 1000, height: 600 },
        borderWidth: 0.5, // 0.5px border is crisp at 2.0x
      },
      {
        selector: "div.odd-centered-modal",
        bounds: { x: 500, y: 200, width: 350, height: 250 },
        borderWidth: 1.0,
        transform: "translate(-50%, -50%)", // -175px translation (integer physical at 2x)
      },
    ];

    const desktop2xAnalysis = validateSubpixelBorders(
      desktop2xElements.map((el) => ({ ...el, dprScales: [2.0] })),
    );
    expect(desktop2xAnalysis.isCompliant).toBe(true);
    expect(desktop2xAnalysis.defects.length).toBe(0);

    // Scenario C: Mobile Super Retina (390x844 @ 3.0x DPR)
    const mobile3xElements: readonly SubpixelElementInput[] = [
      {
        selector: "header.mobile-header",
        bounds: { x: 0, y: 0, width: 390, height: 44 },
        borderWidth: { bottom: 1 / 3 }, // 0.3333px bottom divider resolves to 1.0 physical pixel at 3.0x (crisp!)
      },
      {
        selector: "span.pill-badge",
        bounds: { x: 16, y: 60, width: 80, height: 24 },
        borderWidth: 2 / 3, // 0.6667px border resolves to 2.0 physical pixels at 3.0x (crisp!)
      },
      {
        selector: "div.mobile-card",
        bounds: { x: 16, y: 100, width: 358, height: 200 },
        borderWidth: 1.0, // 1px border resolves to 3.0 physical pixels at 3.0x (crisp!)
      },
      {
        selector: "div.flawed-mobile-card",
        bounds: { x: 16, y: 320, width: 358, height: 200 },
        borderWidth: 0.5, // 0.5px border resolves to 1.5 physical pixels at 3.0x (blurry!)
      },
    ];

    const mobile3xAnalysis = validateSubpixelBorders(
      mobile3xElements.map((el) => ({ ...el, dprScales: [3.0] })),
    );
    expect(mobile3xAnalysis.isCompliant).toBe(false);
    expect(mobile3xAnalysis.defects.length).toBe(1);
    expect(mobile3xAnalysis.defects[0]?.elementSelector).toBe("div.flawed-mobile-card");
    expect(mobile3xAnalysis.defects[0]?.category).toBe("subpixel-hairline-blur");

    // Scenario D: Full Multi-Viewport DPR Spectrum Matrix Analysis
    const universalComponent: SubpixelElementInput = {
      selector: "div.responsive-shell",
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      borderWidth: 1.0,
      dprScales: [1.0, 1.5, 2.0, 3.0],
    };

    const universalAnalysis = validateSubpixelBorders(universalComponent);
    expect(universalAnalysis.evaluatedDprs).toEqual([1.0, 1.5, 2.0, 3.0]);
    expect(universalAnalysis.worstCaseDpr).toBe(1.5); // 1.0px * 1.5 = 1.5 physical px (max error 0.5)
    expect(universalAnalysis.maxRoundingErrorAcrossDprs).toBe(0.5);
    expect(universalAnalysis.dprEvaluations.length).toBe(4);
    expect(universalAnalysis.remediations.length).toBeGreaterThan(0);
  });

  it("evaluates subpixel drift across DPR scales with evaluateSubpixelDrift detecting fractional blur vs crisp rendering", () => {
    // 0.5px border: crisp at 2.0x, blurred at 1.0x, 1.5x, 3.0x
    const drift05 = evaluateSubpixelDrift(0.5, [1.0, 1.5, 2.0, 3.0]);
    expect(drift05.cssWidth).toBe(0.5);
    expect(drift05.isCrispOnAllDprs).toBe(false);
    expect(drift05.crispDprs).toEqual([2.0]);
    expect(drift05.blurredDprs).toEqual([1.0, 1.5, 3.0]);
    expect(drift05.recommendedCssWidth).toBe(1.0);
    expect(drift05.worstCaseRoundingError).toBe(0.5);
    expect(drift05.defects.length).toBe(3);

    // 0.3333px border (1/3 px): crisp at 3.0x (Super Retina), blurred at 1.0x and 2.0x
    const drift033 = evaluateSubpixelDrift(1 / 3, [1.0, 2.0, 3.0]);
    expect(drift033.isCrispOnAllDprs).toBe(false);
    expect(drift033.crispDprs).toEqual([3.0]);
    expect(drift033.blurredDprs).toEqual([1.0, 2.0]);
    expect(drift033.recommendedCssWidth).toBe(1.0);

    // 1.0px border: crisp across integer DPRs [1.0, 2.0, 3.0]
    const drift10 = evaluateSubpixelDrift(1.0, [1.0, 2.0, 3.0]);
    expect(drift10.isCrispOnAllDprs).toBe(true);
    expect(drift10.crispDprs).toEqual([1.0, 2.0, 3.0]);
    expect(drift10.blurredDprs).toEqual([]);
    expect(drift10.defects.length).toBe(0);

    // 4/3 px (1.3333px) border: crisp at 1.5x and 3.0x, blurred at 1.0x and 2.0x
    const drift133 = evaluateSubpixelDrift(4 / 3, [1.0, 1.5, 2.0, 3.0]);
    expect(drift133.crispDprs).toEqual([1.5, 3.0]);
    expect(drift133.blurredDprs).toEqual([1.0, 2.0]);
  });

  it("evaluates edge contrast degradation and nominal vs effective contrast with evaluateEdgeContrast", () => {
    // Crisp 1.0px at 1.0x DPR -> no degradation, passes contrast threshold
    const crispContrast = evaluateEdgeContrast(1.0, 1.0, 4.5, 3.0);
    expect(crispContrast.isCrisp).toBe(true);
    expect(crispContrast.roundingError).toBe(0);
    expect(crispContrast.effectiveContrastRatio).toBe(4.5);
    expect(crispContrast.contrastDegradationPct).toBe(0);
    expect(crispContrast.passesContrastThreshold).toBe(true);

    // Fractional 0.5px at 1.0x DPR -> rounding error 0.5, contrast degraded
    const blurredContrast = evaluateEdgeContrast(0.5, 1.0, 4.5, 3.0);
    expect(blurredContrast.isCrisp).toBe(false);
    expect(blurredContrast.roundingError).toBe(0.5);
    expect(blurredContrast.effectiveContrastRatio).toBeLessThan(4.5);
    expect(blurredContrast.contrastDegradationPct).toBeGreaterThan(0);

    // Crisp 0.5px at 2.0x DPR (Retina) -> physical 1.0px, no degradation
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
    // Single devicePixelRatio property in input
    const singleDprInput: SubpixelElementInput = {
      selector: "header.app-bar",
      bounds: { x: 0, y: 0, width: 390, height: 50 },
      borderWidth: 1 / 3,
      devicePixelRatio: 3.0,
    };

    const singleResult = validateSubpixelBorders(singleDprInput);
    expect(singleResult.evaluatedDprs).toEqual([3.0]);
    expect(singleResult.isCompliant).toBe(true);

    // Override via SubpixelValidationOptions
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

describe("Extended Heuristics: Multi-Viewport Manifest & 4 Pillars Hierarchy", () => {
  const createMockCriterion = (
    id: string,
    pillar: string,
    passed: boolean,
    details = "Evaluated element geometry against design token scale with 0 defects",
    evidence = "Evaluated 12 element snapshots in viewport with 0 violations found",
  ): EvaluatedCriterion => ({
    id,
    pillar: pillar as EvaluatedCriterion["pillar"],
    name: `Criterion ${id}`,
    passed,
    details,
    evidence,
  });

  const createMockManifest = (viewport: string, passed = true): CompanionManifestV2 => ({
    version: "2.0",
    screenId: "dashboard",
    viewport,
    timestamp: new Date().toISOString(),
    verdict: passed ? "CERTIFIED" : "DEFECTS_FOUND",
    totalDefects: passed ? 0 : 1,
    criticalCount: 0,
    seriousCount: passed ? 0 : 1,
    moderateCount: 0,
    minorCount: 0,
    criteria: [
      createMockCriterion("CRIT-MECH-APCA", "mechanical", passed),
      createMockCriterion("CRIT-COGN-FITTS", "cognitive", passed),
      createMockCriterion("CRIT-PROD-TOKENS", "product", passed),
      createMockCriterion("CRIT-UX-FOCUS", "ux", passed),
    ],
    pillars: {
      mechanical: { pillar: "mechanical", passed, defects: [], evaluatedCount: 1 },
      cognitive: { pillar: "cognitive", passed, defects: [], evaluatedCount: 1 },
      product: { pillar: "product", passed, defects: [], evaluatedCount: 1 },
      ux: { pillar: "ux", passed, defects: [], evaluatedCount: 1 },
      custom: { pillar: "custom", passed, defects: [], evaluatedCount: 1 },
    },
    allDefects: [],
    remediationSummary: [],
  });

  const validScreenshot = (viewport: string): ScreenshotArtifact => ({
    viewport,
    path: `/screenshots/${viewport}.png`,
    sizeBytes: 15420,
  });

  it("certifies complete 4-viewport bundle with all 4 mandatory pillars and valid screenshots", () => {
    const input: MultiViewportBundleInput = {
      entries: CANONICAL_VIEWPORTS.map((vp) => ({
        viewport: vp,
        manifest: createMockManifest(vp, true),
        screenshot: validScreenshot(vp),
      })),
    };

    const result = verifyMultiViewportManifests(input);
    expect(result.passed).toBe(true);
    expect(result.verifiedViewports.length).toBe(4);
    expect(result.missingViewports.length).toBe(0);
    expect(result.defects.length).toBe(0);
    expect(result.pillarMatrix["mobile"]?.mechanical).toBe(true);
    expect(result.pillarMatrix["tablet"]?.cognitive).toBe(true);
    expect(result.pillarMatrix["desktop"]?.product).toBe(true);
    expect(result.pillarMatrix["desktop-wide"]?.ux).toBe(true);
  });

  it("flags missing canonical viewport", () => {
    const input: MultiViewportBundleInput = {
      entries: [
        {
          viewport: "mobile",
          manifest: createMockManifest("mobile", true),
          screenshot: validScreenshot("mobile"),
        },
        {
          viewport: "tablet",
          manifest: createMockManifest("tablet", true),
          screenshot: validScreenshot("tablet"),
        },
        {
          viewport: "desktop",
          manifest: createMockManifest("desktop", true),
          screenshot: validScreenshot("desktop"),
        },
      ],
    };

    const result = verifyMultiViewportManifests(input);
    expect(result.passed).toBe(false);
    expect(result.missingViewports).toContain("desktop-wide");
    expect(result.defects.some((d) => d.category === "missing_manifest")).toBe(true);
  });

  it("flags undersized dummy screenshots (< 1024 bytes)", () => {
    const audit = auditSingleViewportManifest("mobile", createMockManifest("mobile", true), {
      viewport: "mobile",
      sizeBytes: 67,
    });

    expect(audit.passed).toBe(false);
    expect(audit.hasValidScreenshot).toBe(false);
    expect(audit.defects.some((d) => d.category === "undersized_screenshot")).toBe(true);
  });

  it("flags manifest missing any of the 4 mandatory pillars", () => {
    const brokenManifest: CompanionManifestV2 = {
      ...createMockManifest("mobile", true),
      criteria: [
        createMockCriterion("CRIT-MECH-1", "mechanical", true),
        createMockCriterion("CRIT-COGN-1", "cognitive", true),
      ],
      pillars: {
        mechanical: { pillar: "mechanical", passed: true, defects: [], evaluatedCount: 1 },
        cognitive: { pillar: "cognitive", passed: true, defects: [], evaluatedCount: 1 },
        custom: { pillar: "custom", passed: true, defects: [], evaluatedCount: 1 },
      },
    };

    const audit = auditSingleViewportManifest("mobile", brokenManifest, validScreenshot("mobile"));
    expect(audit.passed).toBe(false);
    expect(audit.missingPillars).toContain("product");
    expect(audit.missingPillars).toContain("ux");
    expect(audit.defects.some((d) => d.category === "missing_pillar")).toBe(true);
  });

  it("flags criteria with non-boolean pass states or empty details & evidence", () => {
    const rawManifest = {
      version: "2.0",
      viewport: "mobile",
      criteria: [
        {
          id: "CRIT-BAD-1",
          pillar: "mechanical",
          passed: "yes",
          details: "Some details with enough characters",
          evidence: "Some evidence with 24px and 12 elements",
        },
        {
          id: "CRIT-BAD-2",
          pillar: "cognitive",
          passed: true,
          details: "   ",
          evidence: "",
        },
        {
          id: "CRIT-BAD-3",
          pillar: "product",
          passed: false,
          details: "Product token mismatch detected in border radius",
          evidence: "Mismatch found on 2 elements with 10px radius",
        },
        {
          id: "CRIT-OK-4",
          pillar: "ux",
          passed: true,
          details: "Valid UX details describing modal focus containment",
          evidence: "Evaluated 4 interactive buttons with 0 focus leaks",
        },
      ],
    };

    const audit = auditSingleViewportManifest("mobile", rawManifest, validScreenshot("mobile"));
    expect(audit.passed).toBe(false);
    expect(audit.defects.some((d) => d.category === "missing_boolean_passed")).toBe(true);
    expect(audit.defects.some((d) => d.category === "empty_details_evidence")).toBe(true);
    expect(audit.defects.some((d) => d.category === "criterion_failed")).toBe(true);
  });

  it("normalizes pillar strings accurately", () => {
    expect(normalizePillar("mechanical")).toBe("mechanical");
    expect(normalizePillar("MECH")).toBe("mechanical");
    expect(normalizePillar("Cognitive")).toBe("cognitive");
    expect(normalizePillar("Product")).toBe("product");
    expect(normalizePillar("UX")).toBe("ux");
    expect(normalizePillar("ux ergonomics")).toBe("ux");
    expect(normalizePillar("ux_ergonomics")).toBe("ux");
    expect(normalizePillar("ux-ergonomics")).toBe("ux");
    expect(normalizePillar("unknown")).toBeNull();
  });

  it("evaluates CANONICAL_VIEWPORT_SPECS and computePhysicalViewportMetrics across all canonical viewports and DPR scales", () => {
    // 1. desktop-wide (1920x1080 @ 1x / 2x)
    const wide1x = computePhysicalViewportMetrics("desktop-wide", 1.0);
    expect(wide1x.cssWidth).toBe(1920);
    expect(wide1x.cssHeight).toBe(1080);
    expect(wide1x.dpr).toBe(1.0);
    expect(wide1x.physicalWidth).toBe(1920);
    expect(wide1x.physicalHeight).toBe(1080);
    expect(wide1x.totalPhysicalPixels).toBe(1920 * 1080);
    expect(wide1x.isRetinaOrHiDpi).toBe(false);

    const wide2x = computePhysicalViewportMetrics("desktop-wide", 2.0);
    expect(wide2x.physicalWidth).toBe(3840);
    expect(wide2x.physicalHeight).toBe(2160);
    expect(wide2x.totalPhysicalPixels).toBe(3840 * 2160);
    expect(wide2x.isRetinaOrHiDpi).toBe(true);

    // 2. desktop (1440x900 @ 1x / 2x)
    const desk1x = computePhysicalViewportMetrics("desktop", 1.0);
    expect(desk1x.cssWidth).toBe(1440);
    expect(desk1x.cssHeight).toBe(900);
    expect(desk1x.physicalWidth).toBe(1440);
    expect(desk1x.physicalHeight).toBe(900);

    const desk2x = computePhysicalViewportMetrics("desktop", 2.0);
    expect(desk2x.physicalWidth).toBe(2880);
    expect(desk2x.physicalHeight).toBe(1800);
    expect(desk2x.isRetinaOrHiDpi).toBe(true);

    // 3. tablet (768x1024 @ 2x)
    const tablet2x = computePhysicalViewportMetrics("tablet");
    expect(tablet2x.cssWidth).toBe(768);
    expect(tablet2x.cssHeight).toBe(1024);
    expect(tablet2x.dpr).toBe(2.0);
    expect(tablet2x.physicalWidth).toBe(1536);
    expect(tablet2x.physicalHeight).toBe(2048);
    expect(tablet2x.isRetinaOrHiDpi).toBe(true);

    // 4. mobile (390x844 @ 3x Super Retina)
    const mobile3x = computePhysicalViewportMetrics("mobile");
    expect(mobile3x.cssWidth).toBe(390);
    expect(mobile3x.cssHeight).toBe(844);
    expect(mobile3x.dpr).toBe(3.0);
    expect(mobile3x.physicalWidth).toBe(1170);
    expect(mobile3x.physicalHeight).toBe(2532);
    expect(mobile3x.isRetinaOrHiDpi).toBe(true);
  });

  it("synthesizes DPR-aware companion manifest with synthesizeDprAwareCompanionManifest", () => {
    for (const vp of CANONICAL_VIEWPORTS) {
      const manifest = synthesizeDprAwareCompanionManifest(vp);
      expect(manifest.verdict).toBe("CERTIFIED");
      expect(manifest.viewport).toBe(vp);
      expect(manifest.criteria.length).toBeGreaterThanOrEqual(4);
      expect(manifest.criteria.every((c) => c.passed)).toBe(true);
      expect(manifest.pillars.mechanical.passed).toBe(true);
      expect(manifest.pillars.cognitive.passed).toBe(true);
      expect(manifest.pillars.product?.passed).toBe(true);
      expect(manifest.pillars.ux?.passed).toBe(true);

      const audit = auditSingleViewportManifest(vp, manifest, {
        viewport: vp,
        sizeBytes: 4096,
      });
      expect(audit.passed).toBe(true);
      expect(audit.physicalMetrics).toBeDefined();
      expect(audit.dpr).toBe(CANONICAL_VIEWPORT_SPECS[vp].defaultDpr);
    }
  });

  it("verifies multi-viewport bundle with DPR overrides and per-entry DPR settings", () => {
    const input: MultiViewportBundleInput = {
      entries: [
        {
          viewport: "desktop-wide",
          manifest: synthesizeDprAwareCompanionManifest("desktop-wide", { dpr: 2.0 }),
          screenshot: { viewport: "desktop-wide", sizeBytes: 20000, dpr: 2.0 },
          devicePixelRatio: 2.0,
        },
        {
          viewport: "desktop",
          manifest: synthesizeDprAwareCompanionManifest("desktop", { dpr: 1.0 }),
          screenshot: { viewport: "desktop", sizeBytes: 15000, dpr: 1.0 },
          devicePixelRatio: 1.0,
        },
        {
          viewport: "tablet",
          manifest: synthesizeDprAwareCompanionManifest("tablet", { dpr: 2.0 }),
          screenshot: { viewport: "tablet", sizeBytes: 12000, dpr: 2.0 },
          devicePixelRatio: 2.0,
        },
        {
          viewport: "mobile",
          manifest: synthesizeDprAwareCompanionManifest("mobile", { dpr: 3.0 }),
          screenshot: { viewport: "mobile", sizeBytes: 10000, dpr: 3.0 },
          devicePixelRatio: 3.0,
        },
      ],
      dprOverrides: {
        "desktop-wide": 2.0,
        desktop: 1.0,
        tablet: 2.0,
        mobile: 3.0,
      },
    };

    const result = verifyMultiViewportManifests(input);
    expect(result.passed).toBe(true);
    expect(result.verifiedViewports.length).toBe(4);

    const mobileAudit = result.viewportAudits.find((a) => a.viewport === "mobile");
    const tabletAudit = result.viewportAudits.find((a) => a.viewport === "tablet");
    const desktopAudit = result.viewportAudits.find((a) => a.viewport === "desktop");
    const desktopWideAudit = result.viewportAudits.find((a) => a.viewport === "desktop-wide");

    expect(desktopWideAudit?.physicalMetrics?.physicalWidth).toBe(3840);
    expect(desktopAudit?.physicalMetrics?.physicalWidth).toBe(1440);
    expect(tabletAudit?.physicalMetrics?.physicalWidth).toBe(1536);
    expect(mobileAudit?.physicalMetrics?.physicalWidth).toBe(1170);
  });
});

describe("Extended Heuristics: Semantic Depth & Anti-Boilerplate Verification", () => {
  it("certifies high-depth semantic criterion with quantitative metrics and qualitative explanation", () => {
    const deepCriterion: EvaluatedCriterion = {
      id: "CRIT-MECH-APCA",
      pillar: "mechanical",
      name: "APCA Lightness Contrast",
      passed: true,
      details:
        "All heading and body elements satisfy APCA Lc lightness contrast thresholds based on font size and weight.",
      evidence:
        "Evaluated 28 text elements in viewport 'desktop' with 0 contrast violations; lowest measured Lc was 78.4 (required: 60).",
    };

    const depthResult = auditCriterionSemanticDepth(deepCriterion);
    expect(depthResult.isDeep).toBe(true);
    expect(depthResult.combinedDepthScore).toBeGreaterThanOrEqual(0.7);
    expect(depthResult.defects.length).toBe(0);
    expect(depthResult.metricsFound.length).toBeGreaterThanOrEqual(2);
  });

  it("flags and rejects superficial boilerplate details ('ok', 'pass', 'looks good', 'n/a', 'checked', 'none')", () => {
    const boilerplateSamples = [
      "ok",
      "pass",
      "passed",
      "true",
      "yes",
      "n/a",
      "none",
      "looks good",
      "test passed",
      "checked",
      "valid",
      "all good",
      "placeholder",
      "tbd",
    ];

    for (const bp of boilerplateSamples) {
      const criterion = {
        id: "CRIT-TEST-BP",
        pillar: "cognitive",
        details: bp,
        evidence: "Evaluated 10 elements in mobile viewport with 0 errors.",
      };

      const depthResult = auditCriterionSemanticDepth(criterion);
      expect(depthResult.isDeep).toBe(false);
      expect(depthResult.defects.some((d) => d.category === "boilerplate_evidence")).toBe(true);
    }
  });

  it("flags and rejects superficial boilerplate evidence (< 12 chars, 'all good', 'as expected')", () => {
    const badEvidenceSamples = [
      "",
      "   ",
      "ok",
      "all good",
      "done",
      "as expected",
      "fine",
      "looks fine",
    ];

    for (const ev of badEvidenceSamples) {
      const criterion = {
        id: "CRIT-TEST-EV",
        pillar: "product",
        details: "Detailed explanation of design tokens adhering to 8pt spatial grid.",
        evidence: ev,
      };

      const depthResult = auditCriterionSemanticDepth(criterion);
      expect(depthResult.isDeep).toBe(false);
      expect(depthResult.defects.length).toBeGreaterThan(0);
    }
  });

  it("flags evidence missing empirical quantitative measurements or counts", () => {
    const ungroundedCriterion = {
      id: "CRIT-NO-METRICS",
      pillar: "ux",
      details: "Modal focus trap is properly implemented without focus escape.",
      evidence: "Everything appears properly aligned and working.",
    };

    const depthResult = auditCriterionSemanticDepth(ungroundedCriterion);
    expect(
      depthResult.defects.some(
        (d) => d.category === "missing_evidence_metrics" || d.category === "superficial_evidence",
      ),
    ).toBe(true);
  });

  it("audits manifest-level semantic depth across multi-pillar criteria", () => {
    const richManifest = {
      version: "2.0",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: true,
          details:
            "All text elements meet APCA Lc lightness contrast thresholds based on font size and weight.",
          evidence: "Evaluated 18 element snapshots in viewport 'desktop' with 0 violations.",
        },
        {
          id: "CRIT-COGN-FITTS",
          pillar: "cognitive",
          passed: true,
          details: "Primary call-to-action targets maintain low Index of Difficulty ID <= 5.5.",
          evidence: "Evaluated 6 interactive targets with minimum width of 48px and ID of 3.2.",
        },
        {
          id: "CRIT-PROD-TOKENS",
          pillar: "product",
          passed: true,
          details:
            "Typography, spacing, borders, and shadows adhere to design system token scales.",
          evidence: "Evaluated 24 container surfaces conforming to 8pt spatial grid rhythm.",
        },
        {
          id: "CRIT-UX-FOCUS",
          pillar: "ux",
          passed: true,
          details:
            "Modal dialogs and menus constrain keyboard focus cycling and support roving tabindex.",
          evidence: "Verified 4 focusable controls trapped inside modal with 0 leakage.",
        },
      ],
    };

    const manifestDepth = auditManifestSemanticDepth(richManifest);
    expect(manifestDepth.passed).toBe(true);
    expect(manifestDepth.evaluatedCount).toBe(4);
    expect(manifestDepth.deepCount).toBe(4);
    expect(manifestDepth.averageDepthScore).toBeGreaterThanOrEqual(0.7);
    expect(manifestDepth.defects.length).toBe(0);
  });

  it("evaluates all 12 cognitive questions in CognitiveAnalysisReport using validateCognitiveSemanticDepth", () => {
    const sampleElements: ElementPhysicsSnapshot[] = [
      {
        selector: "h1.title",
        tagName: "H1",
        text: "VIP Dispatch Center",
        bounds: { x: 40, y: 40, width: 400, height: 48 },
        computedStyles: {
          fontSize: 32,
          fontWeight: 700,
          color: "#ffffff",
          backgroundColor: "#000000",
        },
      },
      {
        selector: "button.dispatch-btn",
        tagName: "BUTTON",
        text: "Launch Dispatch",
        interactive: true,
        isTouchTarget: true,
        bounds: { x: 40, y: 500, width: 200, height: 48 },
        computedStyles: { fontSize: 16, fontWeight: 600, padding: 16 },
        implementedStates: ["default", "hover", "active", "focus"],
      },
      {
        selector: "span.badge-status",
        tagName: "SPAN",
        text: "LIVE TELEMETRY ONLINE",
        bounds: { x: 500, y: 40, width: 160, height: 28 },
      },
    ];

    const context: ValidationContext = {
      screenId: "dispatch_center",
      viewport: "desktop",
      elements: sampleElements,
      viewportBounds: { width: 1440, height: 900 },
    };

    const report = evaluateCognitiveQuestions({ context, elements: sampleElements });
    expect(report.questions.length).toBe(12);

    const depthAudit = validateCognitiveSemanticDepth(report);
    expect(depthAudit.passed).toBe(true);
    expect(depthAudit.evaluatedCount).toBe(12);
    expect(depthAudit.deepCount).toBe(12);
    expect(depthAudit.superficialCount).toBe(0);
    expect(depthAudit.averageScore).toBe(1.0);
    expect(depthAudit.defects.length).toBe(0);
  });

  it("rejects artificially injected superficial cognitive observations or unevidenced cognitive answers", () => {
    const superficialReport = {
      summary: "Evaluated 2 questions.",
      questionsEvaluated: 2,
      questionsPassed: 2,
      questions: [
        {
          id: "Q-PERC-01-JTBD-ANCHOR",
          category: "perception" as const,
          question: "Does the screen present a clear dominant visual anchor?",
          answered: true,
          passed: true,
          verdict: "OPTIMAL" as const,
          observation: "Looks good",
          evidence: "None",
        },
        {
          id: "Q-ERGO-02-FITTS-ACQUISITION",
          category: "ergonomics" as const,
          question: "Do interactive targets maintain low acquisition difficulty?",
          answered: true,
          passed: true,
          verdict: "OPTIMAL" as const,
          observation: "Short",
          evidence: "Pass",
        },
      ],
    };

    const depthAudit = validateCognitiveSemanticDepth(superficialReport);
    expect(depthAudit.passed).toBe(false);
    expect(depthAudit.defects.length).toBeGreaterThanOrEqual(3);
    expect(depthAudit.deepCount).toBe(0);
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies heuristic sources and test files contain zero any annotations and zero suppressions", () => {
    const filesToAudit = [
      join(import.meta.dir, "../../../olt/scripts/src/heuristics/index.ts"),
      join(import.meta.dir, "../../../olt/scripts/src/heuristics/glass-surfaces/index.ts"),
      join(import.meta.dir, "../../../olt/scripts/src/heuristics/modal-focus-traps/index.ts"),
      join(import.meta.dir, "../../../olt/scripts/src/heuristics/subpixel-borders/index.ts"),
      join(import.meta.dir, "../../../olt/scripts/src/heuristics/multi-viewport-manifest/index.ts"),
      join(import.meta.dir, "../../../olt/scripts/src/heuristics/behavioral-forensics/index.ts"),
      join(import.meta.dir, "heuristics-edge-cases.test.ts"),
      join(
        import.meta.dir,
        "../../../olt/scripts/src/capture/validator/cognitive/cognitive-questions/index.ts",
      ),
    ];

    const forbiddenAnyForms = [
      ":" + " any",
      "as" + " any",
      "<" + "any>",
      "Array<" + "any>",
      "Record<string," + " any>",
      "Promise<" + "any>",
    ];

    const forbiddenSupTokens = [
      "@" + "ts-ignore",
      "@" + "ts-expect-error",
      "@" + "ts-nocheck",
      "eslint-" + "disable",
      "oxlint-" + "disable",
    ];

    for (const filePath of filesToAudit) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      const invalidLines = lines.filter((line, idx) => {
        // If auditing this test file itself, ignore lines inside the invariant test block
        if (filePath.endsWith("heuristics-edge-cases.test.ts")) {
          const invariantBlockIdx = lines.findIndex((l) =>
            l.includes('describe("Static Invariant Verification'),
          );
          if (invariantBlockIdx !== -1 && idx >= invariantBlockIdx) {
            return false;
          }
        }
        return (
          forbiddenAnyForms.some((token) => line.includes(token)) ||
          forbiddenSupTokens.some((token) => line.includes(token))
        );
      });

      expect(invalidLines).toEqual([]);
    }
  });
});
