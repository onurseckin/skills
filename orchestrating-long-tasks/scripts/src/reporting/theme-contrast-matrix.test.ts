import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateApcaContrast,
  calculateRelativeLuminance,
  calculateWcagContrast,
  compositeRgb,
  CONTRAST_STANDARDS,
  evaluateThemeContrastMatrix,
  formatThemeContrastMatrixMarkdown,
  isValidColor,
  parseRgb,
  THEME_MODES,
  type ElementThemePair,
  type MultiThemeComparisonReport,
  type RgbaColor,
} from "./theme-contrast-matrix.ts";

describe("Multi-Theme Contrast Matrix & Dynamic Color Scheme Visual Reporting Engine", () => {
  describe("Color Parsing & Validation", () => {
    it("validates color expressions using isValidColor", () => {
      // Valid hex strings
      expect(isValidColor("#fff")).toBe(true);
      expect(isValidColor("#0000")).toBe(true);
      expect(isValidColor("#123456")).toBe(true);
      expect(isValidColor("#12345678")).toBe(true);
      expect(isValidColor("fff")).toBe(true);
      expect(isValidColor("ffffff")).toBe(true);

      // Valid RGB/RGBA
      expect(isValidColor("rgb(255, 0, 0)")).toBe(true);
      expect(isValidColor("rgb(255 0 0)")).toBe(true);
      expect(isValidColor("rgba(255, 0, 0, 0.5)")).toBe(true);
      expect(isValidColor("rgba(255 0 0 / 0.5)")).toBe(true);
      expect(isValidColor("rgb(100%, 50%, 0%)")).toBe(true);

      // Valid HSL/HSLA
      expect(isValidColor("hsl(120, 100%, 50%)")).toBe(true);
      expect(isValidColor("hsl(120 100% 50%)")).toBe(true);
      expect(isValidColor("hsla(120, 100%, 50%, 0.8)")).toBe(true);
      expect(isValidColor("hsl(0.5turn 100% 50% / 0.5)")).toBe(true);

      // Named colors & transparent
      expect(isValidColor("white")).toBe(true);
      expect(isValidColor("black")).toBe(true);
      expect(isValidColor("transparent")).toBe(true);
      expect(isValidColor("rebeccapurple")).toBe(true);

      // Invalid colors
      expect(isValidColor("")).toBe(false);
      expect(isValidColor("   ")).toBe(false);
      expect(isValidColor("#12")).toBe(false);
      expect(isValidColor("#12345")).toBe(false);
      expect(isValidColor("#123456789")).toBe(false);
      expect(isValidColor("#gggggg")).toBe(false);
      expect(isValidColor("not-a-color")).toBe(false);
    });

    it("parses 3-digit and 6-digit hex colors", () => {
      const white3 = parseRgb("#fff");
      expect(white3).toEqual({ r: 255, g: 255, b: 255, a: 1 });

      const black3 = parseRgb("#000");
      expect(black3).toEqual({ r: 0, g: 0, b: 0, a: 1 });

      const red3 = parseRgb("#f00");
      expect(red3).toEqual({ r: 255, g: 0, b: 0, a: 1 });

      const custom3 = parseRgb("#123");
      expect(custom3).toEqual({ r: 17, g: 34, b: 51, a: 1 });

      const white6 = parseRgb("#ffffff");
      expect(white6).toEqual({ r: 255, g: 255, b: 255, a: 1 });

      const black6 = parseRgb("#000000");
      expect(black6).toEqual({ r: 0, g: 0, b: 0, a: 1 });

      const blue6 = parseRgb("#0000ff");
      expect(blue6).toEqual({ r: 0, g: 0, b: 255, a: 1 });

      const custom6 = parseRgb("#1a2b3c");
      expect(custom6).toEqual({ r: 26, g: 43, b: 60, a: 1 });
    });

    it("parses 4-digit and 8-digit hex colors with alpha channel", () => {
      const white4 = parseRgb("#ffff");
      expect(white4).toEqual({ r: 255, g: 255, b: 255, a: 1 });

      const transparentBlack4 = parseRgb("#0000");
      expect(transparentBlack4).toEqual({ r: 0, g: 0, b: 0, a: 0 });

      const semiRed4 = parseRgb("#f008");
      expect(semiRed4.r).toBe(255);
      expect(semiRed4.g).toBe(0);
      expect(semiRed4.b).toBe(0);
      expect(semiRed4.a).toBeCloseTo(136 / 255, 2);

      const opaque8 = parseRgb("#ffffff00");
      expect(opaque8).toEqual({ r: 255, g: 255, b: 255, a: 0 });

      const semi8 = parseRgb("#00000080");
      expect(semi8.r).toBe(0);
      expect(semi8.g).toBe(0);
      expect(semi8.b).toBe(0);
      expect(semi8.a).toBeCloseTo(128 / 255, 2);

      const custom8 = parseRgb("#123456ff");
      expect(custom8).toEqual({ r: 18, g: 52, b: 86, a: 1 });
    });

    it("parses standard and modern rgb/rgba functional syntax", () => {
      // Legacy comma syntax
      const rgbComma = parseRgb("rgb(255, 128, 0)");
      expect(rgbComma).toEqual({ r: 255, g: 128, b: 0, a: 1 });

      const rgbaComma = parseRgb("rgba(10, 20, 30, 0.75)");
      expect(rgbaComma).toEqual({ r: 10, g: 20, b: 30, a: 0.75 });

      // Percentage channels
      const rgbPct = parseRgb("rgb(100%, 0%, 50%)");
      expect(rgbPct.r).toBe(255);
      expect(rgbPct.g).toBe(0);
      expect(rgbPct.b).toBe(128); // 50% of 255 rounded

      const rgbaPctAlpha = parseRgb("rgba(200, 100, 50, 50%)");
      expect(rgbaPctAlpha).toEqual({ r: 200, g: 100, b: 50, a: 0.5 });

      // Modern space-separated and slash alpha syntax
      const rgbSpace = parseRgb("rgb(64 128 192)");
      expect(rgbSpace).toEqual({ r: 64, g: 128, b: 192, a: 1 });

      const rgbaSlash = parseRgb("rgba(64 128 192 / 0.4)");
      expect(rgbaSlash).toEqual({ r: 64, g: 128, b: 192, a: 0.4 });
    });

    it("parses hsl and hsla functional syntax with various angle units", () => {
      // Basic HSL
      const hslGreen = parseRgb("hsl(120, 100%, 50%)");
      expect(hslGreen).toEqual({ r: 0, g: 255, b: 0, a: 1 });

      const hslWhite = parseRgb("hsl(0, 0%, 100%)");
      expect(hslWhite).toEqual({ r: 255, g: 255, b: 255, a: 1 });

      const hslBlack = parseRgb("hsl(0, 0%, 0%)");
      expect(hslBlack).toEqual({ r: 0, g: 0, b: 0, a: 1 });

      // Degrees, turns, and unitless
      const hslDeg = parseRgb("hsl(180deg, 100%, 50%)");
      expect(hslDeg).toEqual({ r: 0, g: 255, b: 255, a: 1 });

      const hslTurn = parseRgb("hsl(0.5turn 100% 50%)");
      expect(hslTurn).toEqual({ r: 0, g: 255, b: 255, a: 1 });

      const hslUnitless = parseRgb("hsl(180 100% 50%)");
      expect(hslUnitless).toEqual({ r: 0, g: 255, b: 255, a: 1 });

      // HSLA with alpha
      const hslaComma = parseRgb("hsla(240, 100%, 50%, 0.6)");
      expect(hslaComma).toEqual({ r: 0, g: 0, b: 255, a: 0.6 });

      const hslaSlash = parseRgb("hsl(60 100% 50% / 80%)");
      expect(hslaSlash).toEqual({ r: 255, g: 255, b: 0, a: 0.8 });
    });

    it("parses named colors and transparent keyword", () => {
      expect(parseRgb("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseRgb("black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseRgb("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
      expect(parseRgb("lime")).toEqual({ r: 0, g: 255, b: 0, a: 1 });
      expect(parseRgb("blue")).toEqual({ r: 0, g: 0, b: 255, a: 1 });
      expect(parseRgb("yellow")).toEqual({ r: 255, g: 255, b: 0, a: 1 });
      expect(parseRgb("cyan")).toEqual({ r: 0, g: 255, b: 255, a: 1 });
      expect(parseRgb("magenta")).toEqual({ r: 255, g: 0, b: 255, a: 1 });
      expect(parseRgb("gray")).toEqual({ r: 128, g: 128, b: 128, a: 1 });
      expect(parseRgb("grey")).toEqual({ r: 128, g: 128, b: 128, a: 1 });
      expect(parseRgb("rebeccapurple")).toEqual({ r: 102, g: 51, b: 153, a: 1 });
      expect(parseRgb("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it("safely handles malformed inputs without throwing", () => {
      expect(parseRgb("")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(parseRgb("   ")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(parseRgb("unknown-color-name")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(parseRgb("#xyz")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(parseRgb("rgb(1, 2)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
      expect(parseRgb("hsl(100)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });
  });

  describe("Alpha Composite Blending", () => {
    it("blends semi-transparent foreground over opaque background (Porter-Duff source-over)", () => {
      // 80% white text on pure black background -> (204, 204, 204)
      const fgWhite80: RgbaColor = { r: 255, g: 255, b: 255, a: 0.8 };
      const bgBlack: RgbaColor = { r: 0, g: 0, b: 0, a: 1 };
      const blended = compositeRgb(fgWhite80, bgBlack);

      expect(blended.r).toBe(204);
      expect(blended.g).toBe(204);
      expect(blended.b).toBe(204);
      expect(blended.a).toBe(1);

      // 50% black on pure white background -> (128, 128, 128)
      const fgBlack50: RgbaColor = { r: 0, g: 0, b: 0, a: 0.5 };
      const bgWhite: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
      const blendedGrey = compositeRgb(fgBlack50, bgWhite);

      expect(blendedGrey.r).toBe(128);
      expect(blendedGrey.g).toBe(128);
      expect(blendedGrey.b).toBe(128);
      expect(blendedGrey.a).toBe(1);
    });

    it("blends two semi-transparent colors", () => {
      const fgRed50: RgbaColor = { r: 255, g: 0, b: 0, a: 0.5 };
      const bgBlue50: RgbaColor = { r: 0, g: 0, b: 255, a: 0.5 };
      const blended = compositeRgb(fgRed50, bgBlue50);

      // outA = 0.5 + 0.5 * (1 - 0.5) = 0.75
      expect(blended.a).toBe(0.75);
      // r = (255 * 0.5) / 0.75 = 170
      expect(blended.r).toBe(170);
      expect(blended.g).toBe(0);
      // b = (255 * 0.5 * 0.5) / 0.75 = 85
      expect(blended.b).toBe(85);
    });

    it("handles zero alpha edges gracefully", () => {
      const transparent: RgbaColor = { r: 0, g: 0, b: 0, a: 0 };
      const bgOpaque: RgbaColor = { r: 100, g: 150, b: 200, a: 1 };

      const resBg = compositeRgb(transparent, bgOpaque);
      expect(resBg).toEqual(bgOpaque);

      const resAllZero = compositeRgb(transparent, transparent);
      expect(resAllZero).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });
  });

  describe("Relative Luminance & WCAG 2.1 Contrast Calculation", () => {
    it("computes exact sRGB relative luminance according to WCAG 2.1 formula", () => {
      expect(calculateRelativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
      expect(calculateRelativeLuminance({ r: 255, g: 255, b: 255 })).toBe(1);

      // Primary colors relative luminance coefficients
      const redLum = calculateRelativeLuminance({ r: 255, g: 0, b: 0 });
      expect(redLum).toBeCloseTo(0.2126, 4);

      const greenLum = calculateRelativeLuminance({ r: 0, g: 255, b: 0 });
      expect(greenLum).toBeCloseTo(0.7152, 4);

      const blueLum = calculateRelativeLuminance({ r: 0, g: 0, b: 255 });
      expect(blueLum).toBeCloseTo(0.0722, 4);

      // Midpoint grey
      const midGreyLum = calculateRelativeLuminance({ r: 128, g: 128, b: 128 });
      expect(midGreyLum).toBeCloseTo(0.2158, 3);
    });

    it("calculates WCAG contrast ratio for reference color pairs", () => {
      // Maximum contrast (21:1)
      const blackOnWhite = calculateWcagContrast("#000000", "#ffffff");
      expect(blackOnWhite).toBe(21.0);

      // Minimum contrast (1:1)
      const whiteOnWhite = calculateWcagContrast("#ffffff", "#ffffff");
      expect(whiteOnWhite).toBe(1.0);

      const blackOnBlack = calculateWcagContrast("#000000", "#000000");
      expect(blackOnBlack).toBe(1.0);

      // Symmetry property: CR(A, B) === CR(B, A)
      const blueOnWhite = calculateWcagContrast("#0000ff", "#ffffff");
      const whiteOnBlue = calculateWcagContrast("#ffffff", "#0000ff");
      expect(blueOnWhite).toBe(whiteOnBlue);
      expect(blueOnWhite).toBeCloseTo(8.59, 1);

      // Yellow on white (poor contrast ~ 1.07:1)
      const yellowOnWhite = calculateWcagContrast("#ffff00", "#ffffff");
      expect(yellowOnWhite).toBeCloseTo(1.07, 1);

      // Standard body text: #333333 on #ffffff (~12.63:1)
      const bodyText = calculateWcagContrast("#333333", "#ffffff");
      expect(bodyText).toBeGreaterThanOrEqual(12.0);
    });

    it("evaluates WCAG contrast with semi-transparent foregrounds", () => {
      // 80% white text on black background -> (204, 204, 204) on (0, 0, 0)
      const semiWhiteOnBlack = calculateWcagContrast("rgba(255, 255, 255, 0.8)", "#000000");
      expect(semiWhiteOnBlack).toBeGreaterThanOrEqual(12.0);

      // 30% black text on white background -> light grey on white -> low contrast
      const faintText = calculateWcagContrast("rgba(0, 0, 0, 0.3)", "#ffffff");
      expect(faintText).toBeLessThan(3.0);
    });
  });

  describe("APCA Lightness Contrast (Lc) Calculation", () => {
    it("computes APCA Lc values for reference polarity pairs", () => {
      // Dark text on light background -> positive Lc
      const blackOnWhiteLc = calculateApcaContrast("#000000", "#ffffff");
      expect(blackOnWhiteLc).toBeGreaterThan(100.0);
      expect(blackOnWhiteLc).toBeLessThan(108.0);

      // Light text on dark background -> negative Lc
      const whiteOnBlackLc = calculateApcaContrast("#ffffff", "#000000");
      expect(whiteOnBlackLc).toBeLessThan(-100.0);
      expect(whiteOnBlackLc).toBeGreaterThan(-110.0);

      // Identical colors -> zero contrast
      const sameColorLc = calculateApcaContrast("#888888", "#888888");
      expect(sameColorLc).toBe(0);
    });

    it("computes APCA contrast with semi-transparent foregrounds", () => {
      const semiWhiteOnDark = calculateApcaContrast("rgba(255, 255, 255, 0.8)", "#121212");
      expect(Math.abs(semiWhiteOnDark)).toBeGreaterThan(70.0);
    });
  });

  describe("Multi-Theme Matrix Evaluation", () => {
    it("evaluates elements across light, dark, and high-contrast modes with 100% compliance", () => {
      const elements: ElementThemePair[] = [
        {
          selector: "button.primary-action",
          element: "Primary CTA Button",
          theme: "light",
          foregroundColor: "#ffffff",
          backgroundColor: "#003366", // Navy: CR ~ 13.6:1, passes AA, AAA, APCA
          fontSize: 16,
          fontWeight: 600,
        },
        {
          selector: "button.primary-action",
          element: "Primary CTA Button",
          theme: "dark",
          foregroundColor: "#ffffff",
          backgroundColor: "#121212", // Dark: CR ~ 16.0:1, passes AA, AAA, APCA
          fontSize: 16,
          fontWeight: 600,
        },
        {
          selector: "button.primary-action",
          element: "Primary CTA Button",
          theme: "high-contrast-light",
          foregroundColor: "#000000",
          backgroundColor: "#ffffff", // Pure White substrate: CR 21:1
          fontSize: 16,
          fontWeight: 600,
        },
        {
          selector: "button.primary-action",
          element: "Primary CTA Button",
          theme: "high-contrast-dark",
          foregroundColor: "#ffffff",
          backgroundColor: "#000000", // Pure Black substrate: CR 21:1
          fontSize: 16,
          fontWeight: 600,
        },
      ];

      const report = evaluateThemeContrastMatrix(elements);

      expect(report.totalElements).toBe(1);
      expect(report.overallPassed).toBe(true);
      expect(report.findings.length).toBe(0);
      expect(report.summary.totalChecks).toBe(12); // 4 themes * 3 standards
      expect(report.summary.passedChecks).toBe(12);
      expect(report.summary.failedChecks).toBe(0);
      expect(report.summary.passRate).toBe(100);

      const matrix = report.matrices[0]!;
      expect(matrix.overallPassed).toBe(true);
      expect(matrix.themes.light?.passed).toBe(true);
      expect(matrix.themes.dark?.passed).toBe(true);
      expect(matrix.themes["high-contrast-light"]?.passed).toBe(true);
      expect(matrix.themes["high-contrast-dark"]?.passed).toBe(true);
    });

    it("applies relaxed thresholds for large text elements (>= 24px or >= 18.66px bold)", () => {
      const largeTextElements: ElementThemePair[] = [
        {
          selector: "h1.hero-heading",
          theme: "light",
          foregroundColor: "#666666", // CR ~ 5.7:1 (Fails AAA normal text 7:1, but passes AAA large text 4.5:1)
          backgroundColor: "#ffffff",
          fontSize: 32,
          fontWeight: 700,
          isLargeText: true,
        },
        {
          selector: "h1.hero-heading",
          theme: "dark",
          foregroundColor: "#aaaaaa", // CR ~ 6.3:1
          backgroundColor: "#121212",
          fontSize: 32,
          fontWeight: 700,
          isLargeText: true,
        },
      ];

      const report = evaluateThemeContrastMatrix(largeTextElements, ["wcag-aa", "wcag-aaa"]);
      expect(report.overallPassed).toBe(true);
      expect(report.matrices[0]?.isLargeText).toBe(true);
    });

    it("flags missing theme configurations in multi-theme matrix", () => {
      const incompleteElements: ElementThemePair[] = [
        {
          selector: "nav.top-bar",
          theme: "light",
          foregroundColor: "#000000",
          backgroundColor: "#ffffff",
        },
        {
          selector: "button.sidebar-toggle",
          theme: "dark",
          foregroundColor: "#ffffff",
          backgroundColor: "#000000",
        },
      ];

      const report = evaluateThemeContrastMatrix(incompleteElements);
      expect(report.overallPassed).toBe(false);

      const missingFindings = report.findings.filter((f) => f.id.includes("MISSING"));
      expect(missingFindings.length).toBeGreaterThanOrEqual(2);
      expect(missingFindings.some((f) => f.selector === "nav.top-bar" && f.theme === "dark")).toBe(true);
      expect(missingFindings.some((f) => f.selector === "button.sidebar-toggle" && f.theme === "light")).toBe(true);
    });

    it("detects and flags invalid color expressions gracefully", () => {
      const invalidElements: ElementThemePair[] = [
        {
          selector: "div.error-banner",
          theme: "light",
          foregroundColor: "invalid-color",
          backgroundColor: "#ffffff",
        },
        {
          selector: "div.error-banner",
          theme: "dark",
          foregroundColor: "#ffffff",
          backgroundColor: "#000000",
        },
      ];

      const report = evaluateThemeContrastMatrix(invalidElements);
      expect(report.overallPassed).toBe(false);

      const syntaxFinding = report.findings.find((f) => f.id.includes("SYNTAX"));
      expect(syntaxFinding).toBeDefined();
      expect(syntaxFinding?.severity).toBe("critical");
      expect(syntaxFinding?.message).toContain("invalid-color");
    });
  });

  describe("Theme Regression Detection", () => {
    it("detects dark mode contrast regression where light mode passes (7.5:1) but dark mode fails (2.1:1)", () => {
      const regressedElements: ElementThemePair[] = [
        {
          selector: "button.secondary-btn",
          element: "Secondary Outline Button",
          theme: "light",
          foregroundColor: "#0052cc", // Blue on White: CR ~ 8.9:1 (Passes AA and AAA)
          backgroundColor: "#ffffff",
        },
        {
          selector: "button.secondary-btn",
          element: "Secondary Outline Button",
          theme: "dark",
          foregroundColor: "#205493", // Dark Blue on Dark Background: CR ~ 1.8:1 (FAILS AA)
          backgroundColor: "#1e1e1e",
        },
      ];

      const report = evaluateThemeContrastMatrix(regressedElements, ["wcag-aa"]);

      expect(report.overallPassed).toBe(false);
      expect(report.matrices[0]?.themes.light?.passed).toBe(true);
      expect(report.matrices[0]?.themes.dark?.passed).toBe(false);

      const darkRegression = report.findings.find((f) => f.id.includes("REGRESS-DARK"));
      expect(darkRegression).toBeDefined();
      expect(darkRegression?.severity).toBe("serious");
      expect(darkRegression?.selector).toBe("button.secondary-btn");
      expect(darkRegression?.message).toContain("Dark mode contrast regression");
      expect(darkRegression?.message).toContain("passes in light mode");
      expect(darkRegression?.message).toContain("regresses and fails in dark mode");
    });

    it("detects high-contrast inverted regressions where high-contrast theme has less contrast than standard theme", () => {
      const invertedElements: ElementThemePair[] = [
        {
          selector: "span.badge",
          theme: "light",
          foregroundColor: "#000000",
          backgroundColor: "#ffffff", // CR = 21:1
        },
        {
          selector: "span.badge",
          theme: "high-contrast-light",
          foregroundColor: "#555555",
          backgroundColor: "#ffffff", // CR ~ 7.5:1 (Higher contrast required!)
        },
      ];

      const report = evaluateThemeContrastMatrix(invertedElements, ["wcag-aa"]);
      const hcRegression = report.findings.find((f) => f.id.includes("REGRESS-HC"));
      expect(hcRegression).toBeDefined();
      expect(hcRegression?.severity).toBe("moderate");
      expect(hcRegression?.message).toContain("High-contrast light mode inverted contrast");
    });
  });

  describe("Markdown Report Formatting & ASCII/Unicode Matrix Tables", () => {
    it("formats clean ASCII/Unicode Markdown report with summary box, matrix tables, and regressions", () => {
      const elements: ElementThemePair[] = [
        {
          selector: "a.nav-link",
          element: "Navigation Link",
          theme: "light",
          foregroundColor: "#000000",
          backgroundColor: "#ffffff", // CR: 21:1 (passes all)
        },
        {
          selector: "a.nav-link",
          element: "Navigation Link",
          theme: "dark",
          foregroundColor: "#333333", // Fails on dark (CR ~ 1.48:1)
          backgroundColor: "#121212",
        },
      ];

      const report = evaluateThemeContrastMatrix(elements, CONTRAST_STANDARDS);
      const markdown = formatThemeContrastMatrixMarkdown(report);

      expect(markdown).toContain("# Multi-Theme Contrast & Dynamic Color Scheme Visual Report");
      expect(markdown).toContain("┌────────────────────────────────────────────────────────────────────────┐");
      expect(markdown).toContain("│ Multi-Theme Contrast Compliance Summary                                │");
      expect(markdown).toContain("└────────────────────────────────────────────────────────────────────────┘");
      expect(markdown).toContain("## Theme-Specific Compliance Rates");
      expect(markdown).toContain("## High-Level Element Contrast Matrix");
      expect(markdown).toContain("| Selector | light | dark | Status |");
      expect(markdown).toContain("## Detailed Multi-Theme Evaluations");
      expect(markdown).toContain("## Contrast Regressions & Findings");
      expect(markdown).toContain("[SERIOUS]");
      expect(markdown).toContain("Dark mode contrast regression");
    });

    it("renders clean zero-regression message when all elements pass across themes", () => {
      const compliantElements: ElementThemePair[] = [
        {
          selector: "button.confirm",
          theme: "light",
          foregroundColor: "#ffffff",
          backgroundColor: "#000000",
        },
        {
          selector: "button.confirm",
          theme: "dark",
          foregroundColor: "#000000",
          backgroundColor: "#ffffff",
        },
      ];

      const report = evaluateThemeContrastMatrix(compliantElements, ["wcag-aa"]);
      const markdown = formatThemeContrastMatrixMarkdown(report);

      expect(markdown).toContain("Overall Status       : PASS");
      expect(markdown).toContain("No contrast regressions or color scheme defects detected across evaluated themes.");
    });
  });

  describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    it("verifies zero TypeScript any and zero compiler/linter suppressions across theme contrast files", () => {
      const filesToAudit = [
        resolve(import.meta.dir, "theme-contrast-matrix.ts"),
        resolve(import.meta.dir, "theme-contrast-matrix.test.ts"),
      ];

      const anyPattern = /:\s*any\b|as\s+any\b|<any>|\bany\s*>/;
      const suppressionPattern = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|oxlint-disable/;

      for (const filePath of filesToAudit) {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Skip lines defining the test regex itself
          if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

          expect(anyPattern.test(line)).toBe(false);
          expect(suppressionPattern.test(line)).toBe(false);
        }
      }
    });
  });
});
