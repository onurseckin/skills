import { describe, it, expect } from "bun:test";
import {
  evaluateThemeContrastMatrix,
  formatThemeContrastMatrixMarkdown,
  type ElementThemePair,
} from "../../../../../olt/scripts/src/reporting/theme/index.ts";

describe("theme contrast matrix setup and multi-theme reports", () => {
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
});
