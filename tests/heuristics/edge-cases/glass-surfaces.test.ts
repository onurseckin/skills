/**
 * @file glass-surfaces.test.ts
 * Modular unit tests for Nested Glass Surfaces & Translucency Dynamics
 */

import { describe, expect, it } from "bun:test";
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
} from "../../../olt/scripts/src/heuristics/glass-surfaces/index.ts";

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

    const closeToZero = calculateApcaLightnessContrast(
      { r: 128, g: 128, b: 128, a: 1 },
      { r: 128, g: 128, b: 128, a: 1 },
    );
    expect(closeToZero).toBe(0);
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
    expect(getRequiredApcaLc(12, 400)).toBe(90);
    expect(getRequiredApcaLc(14, 600)).toBe(90);
    expect(getRequiredApcaLc(16, 400)).toBe(75);
    expect(getRequiredApcaLc(18, 400)).toBe(75);
    expect(getRequiredApcaLc(18, 700)).toBe(60);
    expect(getRequiredApcaLc(24, 400)).toBe(60);
    expect(getRequiredApcaLc(36, 700)).toBe(60);
  });

  it("detects luminance clash dead-zone (|Y_text - Y_bg| < 0.05) causing edge vibration", () => {
    const stack: GlassSurfaceLayer[] = [
      {
        selector: ".gray-glass",
        backgroundColor: "rgba(128, 128, 128, 0.9)",
        backdropFilter: "blur(8px)",
      },
    ];
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
      { selector: ".no-blur-glass", backgroundColor: "rgba(255, 255, 255, 0.5)" },
    ];
    const result = analyzeGlassSurfaces(stack);
    expect(result.isCompliant).toBe(false);
    expect(result.defects.some((d) => d.category === "glass-missing-blur")).toBe(true);
  });

  it("handles extreme alphas and edge-case color conversions without NaN", () => {
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
