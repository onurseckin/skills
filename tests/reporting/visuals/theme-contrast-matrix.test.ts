import { describe, it, expect } from "bun:test";
import {
  calculateApcaContrast,
  calculateRelativeLuminance,
  calculateWcagContrast,
  clampAlpha,
  clampByte,
  compositeRgb,
  evaluateSingleStandard,
  evaluateThemeContrastMatrix,
  formatThemeContrastMatrixMarkdown,
  getRequiredThreshold,
  isValidColor,
  parseAlphaValue,
  parseChannelValue,
  parseHue,
  parseRgb,
  resolveIsLargeText,
  type ElementThemePair,
} from "../../../olt/scripts/src/reporting/theme/index.ts";

export const themeContrastMatrixSuiteName = "theme contrast matrix, color-space core, and multi-theme evaluation";

describe(themeContrastMatrixSuiteName, () => {
  describe("color-space core", () => {
    it("clamps bytes and alpha correctly", () => {
      expect(clampByte(-10)).toBe(0);
      expect(clampByte(300)).toBe(255);
      expect(clampByte(128.4)).toBe(128);
      expect(clampByte(NaN)).toBe(0);

      expect(clampAlpha(-0.5)).toBe(0);
      expect(clampAlpha(1.5)).toBe(1);
      expect(clampAlpha(0.75)).toBe(0.75);
      expect(clampAlpha(NaN)).toBe(1);
    });

    it("parses channel values and percentages", () => {
      expect(parseChannelValue("100")).toBe(100);
      expect(parseChannelValue("50%")).toBeCloseTo(127.5);
      expect(parseAlphaValue("50%")).toBe(0.5);
      expect(parseAlphaValue("0.8")).toBe(0.8);
      expect(parseAlphaValue(undefined)).toBe(1);
    });

    it("parses hues across different units", () => {
      expect(parseHue("180deg")).toBe(180);
      expect(parseHue("0.5turn")).toBe(180);
      expect(parseHue("200grad")).toBe(180);
      expect(parseHue("3.14159265rad")).toBeCloseTo(180, 1);
      expect(parseHue("270")).toBe(270);
      expect(parseHue("-90deg")).toBe(270);
    });

    it("validates colors correctly", () => {
      expect(isValidColor("red")).toBe(true);
      expect(isValidColor("#fff")).toBe(true);
      expect(isValidColor("#123456")).toBe(true);
      expect(isValidColor("#12345678")).toBe(true);
      expect(isValidColor("rgb(255, 0, 0)")).toBe(true);
      expect(isValidColor("rgba(255, 0, 0, 0.5)")).toBe(true);
      expect(isValidColor("hsl(120, 100%, 50%)")).toBe(true);
      expect(isValidColor("hsla(120, 100%, 50%, 0.3)")).toBe(true);
      expect(isValidColor("invalid-color")).toBe(false);
      expect(isValidColor("")).toBe(false);
    });

    it("parses hex, rgb, and hsl colors", () => {
      expect(parseRgb("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseRgb("black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseRgb("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
      expect(parseRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
      expect(parseRgb("rgb(0, 255, 0)")).toEqual({ r: 0, g: 255, b: 0, a: 1 });
      expect(parseRgb("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    });

    it("calculates relative luminance and contrast ratios", () => {
      const whiteLum = calculateRelativeLuminance({ r: 255, g: 255, b: 255 });
      const blackLum = calculateRelativeLuminance({ r: 0, g: 0, b: 0 });
      expect(whiteLum).toBeCloseTo(1.0);
      expect(blackLum).toBeCloseTo(0.0);

      const wcag = calculateWcagContrast("#ffffff", "#000000");
      expect(wcag).toBe(21);

      const apca = calculateApcaContrast("#ffffff", "#000000");
      expect(typeof apca).toBe("number");
      expect(Math.abs(apca)).toBeGreaterThan(50);
    });

    it("composites translucent colors", () => {
      const fg = { r: 255, g: 0, b: 0, a: 0.5 };
      const bg = { r: 0, g: 0, b: 255, a: 1 };
      const blended = compositeRgb(fg, bg);
      expect(blended.a).toBe(1);
      expect(blended.r).toBeGreaterThan(0);
      expect(blended.b).toBeGreaterThan(0);
    });

    it("calculates contrast accurately with dark mode canvas backing", () => {
      const translucentBg = "rgba(255, 255, 255, 0.1)";
      const text = "#ffffff";
      const contrastOnDark = calculateWcagContrast(text, translucentBg, "#000000");
      expect(contrastOnDark).toBeGreaterThan(5);

      const apcaOnDark = calculateApcaContrast(text, translucentBg, "#000000");
      expect(Math.abs(apcaOnDark)).toBeGreaterThan(40);
    });
  });

  describe("thresholds and multi-theme evaluation", () => {
    it("resolves large text correctly", () => {
      expect(resolveIsLargeText(true)).toBe(true);
      expect(resolveIsLargeText(false)).toBe(false);
      expect(resolveIsLargeText(undefined, 24, "normal")).toBe(true);
      expect(resolveIsLargeText(undefined, 18.66, "bold")).toBe(true);
      expect(resolveIsLargeText(undefined, 16, 700)).toBe(true);
      expect(resolveIsLargeText(undefined, 14, "bold")).toBe(false);
      expect(resolveIsLargeText(undefined, 16, "normal")).toBe(false);
    });

    it("returns correct required thresholds", () => {
      expect(getRequiredThreshold("wcag-aa", false)).toBe(4.5);
      expect(getRequiredThreshold("wcag-aa", true)).toBe(3.0);
      expect(getRequiredThreshold("wcag-aaa", false)).toBe(7.0);
      expect(getRequiredThreshold("wcag-aaa", true)).toBe(4.5);
      expect(getRequiredThreshold("apca", false)).toBe(75.0);
      expect(getRequiredThreshold("apca", true)).toBe(60.0);
    });

    it("evaluates single standard accurately", () => {
      const passEval = evaluateSingleStandard("wcag-aa", 7.0, 80, false);
      expect(passEval.passed).toBe(true);
      expect(passEval.standard).toBe("wcag-aa");

      const failEval = evaluateSingleStandard("wcag-aa", 3.2, 40, false);
      expect(failEval.passed).toBe(false);
    });

    it("evaluates fully compliant multi-theme setup", () => {
      const pairs: readonly ElementThemePair[] = [
        {
          selector: ".header",
          theme: "light",
          foregroundColor: "#000000",
          backgroundColor: "#ffffff",
        },
        {
          selector: ".header",
          theme: "dark",
          foregroundColor: "#ffffff",
          backgroundColor: "#000000",
        },
      ];

      const report = evaluateThemeContrastMatrix(pairs, ["wcag-aa"]);
      expect(report.overallPassed).toBe(true);
      expect(report.summary.totalChecks).toBe(2);
      expect(report.summary.passedChecks).toBe(2);
      expect(report.summary.failedChecks).toBe(0);
      expect(report.summary.passRate).toBe(100);
      expect(report.findings.length).toBe(0);

      const formatted = formatThemeContrastMatrixMarkdown(report);
      expect(formatted).toContain("PASS");
      expect(formatted).toContain("No contrast regressions");
    });

    it("detects inverted high-contrast regressions", () => {
      const pairs: readonly ElementThemePair[] = [
        {
          selector: ".box",
          theme: "light",
          foregroundColor: "#000000",
          backgroundColor: "#ffffff",
        },
        {
          selector: ".box",
          theme: "high-contrast-light",
          foregroundColor: "#777777",
          backgroundColor: "#ffffff",
        },
      ];

      const report = evaluateThemeContrastMatrix(pairs, ["wcag-aa"]);
      const hcRegress = report.findings.find((f) => f.id.includes("REGRESS-HC"));
      expect(hcRegress).toBeDefined();
    });

    it("detects dark mode regression when light passes and dark fails", () => {
      const pairs: readonly ElementThemePair[] = [
        {
          selector: ".card",
          theme: "light",
          foregroundColor: "#000000",
          backgroundColor: "#ffffff",
        },
        {
          selector: ".card",
          theme: "dark",
          foregroundColor: "#444444",
          backgroundColor: "#222222",
        },
      ];

      const report = evaluateThemeContrastMatrix(pairs, ["wcag-aa"]);
      expect(report.overallPassed).toBe(false);
      const darkRegress = report.findings.find((f) => f.id.includes("REGRESS-DARK"));
      expect(darkRegress).toBeDefined();
    });
  });
});
