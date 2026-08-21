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
} from "./glass-surfaces.ts";
import {
  validateModalFocusTrap,
  type ModalFocusTrapInput,
} from "./modal-focus-traps.ts";
import {
  CANONICAL_FRACTIONAL_DPR_SCALES,
  getPhysicalRoundingError,
  normalizeBorderWidths,
  parseTransformTranslations,
  validateSubpixelBorders,
} from "./subpixel-borders.ts";
import {
  auditCriterionSemanticDepth,
  auditManifestSemanticDepth,
  auditSingleViewportManifest,
  CANONICAL_VIEWPORTS,
  MANDATORY_PILLARS,
  normalizePillar,
  verifyMultiViewportManifests,
  type MultiViewportBundleInput,
  type ScreenshotArtifact,
} from "./multi-viewport-manifest.ts";
import {
  evaluateCognitiveQuestions,
  validateCognitiveSemanticDepth,
} from "../capture/validator/cognitive/cognitive-questions.ts";
import type {
  CompanionManifestV2,
  ElementPhysicsSnapshot,
  EvaluatedCriterion,
  ValidationContext,
} from "../capture/validator/types.ts";

describe("Extended Heuristics: Nested Glass Surfaces & Translucency Dynamics", () => {
  it("parses diverse color formats accurately (hex3, hex4, hex6, hex8, rgb, rgba with %, hsla, named, malformed)", () => {
    expect(parseColorToRgba("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColorToRgba("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColorToRgba("#ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
    expect(parseColorToRgba("#1234")).toEqual({ r: 17, g: 34, b: 51, a: 68 / 255 });
    expect(parseColorToRgba("rgba(100, 150, 200, 0.5)")).toEqual({ r: 100, g: 150, b: 200, a: 0.5 });
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
      { selector: ".modal-backdrop", backgroundColor: "rgba(0, 0, 0, 0.4)", backdropFilter: "blur(20px)" },
      { selector: ".modal-window", backgroundColor: "rgba(255, 255, 255, 0.6)", backdropFilter: "blur(12px)" },
      { selector: ".modal-section", backgroundColor: "rgba(255, 255, 255, 0.4)", backdropFilter: "blur(8px)" },
      { selector: ".glass-pill", backgroundColor: "rgba(0, 0, 0, 0.2)", backdropFilter: "blur(4px)" },
      { selector: ".glass-badge", backgroundColor: "rgba(255, 255, 255, 0.8)", backdropFilter: "blur(2px)" },
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
      outsideSiblings: [
        { selector: "#sidebar", ariaHidden: false, isInert: false },
      ],
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
        { viewport: "mobile", manifest: createMockManifest("mobile", true), screenshot: validScreenshot("mobile") },
        { viewport: "tablet", manifest: createMockManifest("tablet", true), screenshot: validScreenshot("tablet") },
        { viewport: "desktop", manifest: createMockManifest("desktop", true), screenshot: validScreenshot("desktop") },
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
});

describe("Extended Heuristics: Semantic Depth & Anti-Boilerplate Verification", () => {
  it("certifies high-depth semantic criterion with quantitative metrics and qualitative explanation", () => {
    const deepCriterion: EvaluatedCriterion = {
      id: "CRIT-MECH-APCA",
      pillar: "mechanical",
      name: "APCA Lightness Contrast",
      passed: true,
      details: "All heading and body elements satisfy APCA Lc lightness contrast thresholds based on font size and weight.",
      evidence: "Evaluated 28 text elements in viewport 'desktop' with 0 contrast violations; lowest measured Lc was 78.4 (required: 60).",
    };

    const depthResult = auditCriterionSemanticDepth(deepCriterion);
    expect(depthResult.isDeep).toBe(true);
    expect(depthResult.combinedDepthScore).toBeGreaterThanOrEqual(0.7);
    expect(depthResult.defects.length).toBe(0);
    expect(depthResult.metricsFound.length).toBeGreaterThanOrEqual(2);
  });

  it("flags and rejects superficial boilerplate details ('ok', 'pass', 'looks good', 'n/a', 'checked', 'none')", () => {
    const boilerplateSamples = ["ok", "pass", "passed", "true", "yes", "n/a", "none", "looks good", "test passed", "checked", "valid", "all good", "placeholder", "tbd"];

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
    const badEvidenceSamples = ["", "   ", "ok", "all good", "done", "as expected", "fine", "looks fine"];

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
    expect(depthResult.defects.some((d) => d.category === "missing_evidence_metrics" || d.category === "superficial_evidence")).toBe(true);
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
          details: "All text elements meet APCA Lc lightness contrast thresholds based on font size and weight.",
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
          details: "Typography, spacing, borders, and shadows adhere to design system token scales.",
          evidence: "Evaluated 24 container surfaces conforming to 8pt spatial grid rhythm.",
        },
        {
          id: "CRIT-UX-FOCUS",
          pillar: "ux",
          passed: true,
          details: "Modal dialogs and menus constrain keyboard focus cycling and support roving tabindex.",
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
        computedStyles: { fontSize: 32, fontWeight: 700, color: "#ffffff", backgroundColor: "#000000" },
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
      join(__dirname, "glass-surfaces.ts"),
      join(__dirname, "modal-focus-traps.ts"),
      join(__dirname, "subpixel-borders.ts"),
      join(__dirname, "multi-viewport-manifest.ts"),
      join(__dirname, "heuristics-edge-cases.test.ts"),
      join(__dirname, "../capture/validator/cognitive/cognitive-questions.ts"),
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
        if (filePath.endsWith("heuristics-edge-cases.test.ts") && idx >= 845) {
          return false;
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
