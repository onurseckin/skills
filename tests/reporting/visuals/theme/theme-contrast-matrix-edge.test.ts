import { describe, it, expect } from "bun:test";
import {
  resolveIsLargeText,
  getRequiredThreshold,
  evaluateSingleStandard,
  evaluateThemeContrastMatrix,
  formatThemeContrastMatrixMarkdown,
  type ElementThemePair,
} from "../../../../../olt/scripts/src/reporting/theme/index.ts";

describe("theme contrast matrix edge and evaluation", () => {
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

  it("handles missing theme pairs and invalid syntax in matrix evaluation", () => {
    const pairs: readonly ElementThemePair[] = [
      {
        selector: ".btn-primary",
        theme: "light",
        foregroundColor: "#ffffff",
        backgroundColor: "#0055ff",
      },
      {
        selector: ".btn-primary",
        theme: "dark",
        foregroundColor: "invalid-syntax",
        backgroundColor: "#000000",
      },
    ];

    const report = evaluateThemeContrastMatrix(pairs, ["wcag-aa"]);
    expect(report.overallPassed).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);

    const md = formatThemeContrastMatrixMarkdown(report);
    expect(typeof md).toBe("string");
    expect(md).toContain("Multi-Theme Contrast");
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
