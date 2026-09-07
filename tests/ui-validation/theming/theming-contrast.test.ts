import {
  describe,
  expect,
  it,
  calculateApcaContrast,
  calculateRelativeLuminance,
  calculateWcagContrastRatio,
  isApcaCompliant,
  isWcagAaCompliant,
  isWcagAaaCompliant,
  MathematicalContrastPreFilter,
  parseColorToRgb,
} from "../fixtures.ts";

describe("Theming - Contrast Calculation & Thematic Gating", () => {
  describe("8. Automated Mathematical Contrast Calculation (WCAG 2.1 & APCA)", () => {
    it("should parse various color formats to RGB correctly", () => {
      expect(parseColorToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(parseColorToRgb("#000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
      expect(parseColorToRgb("rgb(100, 150, 200)")).toEqual({ r: 100, g: 150, b: 200, a: 1 });
      expect(parseColorToRgb("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    });

    it("should calculate accurate WCAG 2.1 relative luminance", () => {
      const blackLum = calculateRelativeLuminance("#000000");
      const whiteLum = calculateRelativeLuminance("#ffffff");

      expect(blackLum).toBe(0);
      expect(whiteLum).toBe(1);

      const midLum = calculateRelativeLuminance("#777777");
      expect(midLum).toBeGreaterThan(0.1);
      expect(midLum).toBeLessThan(0.3);
    });

    it("should calculate WCAG 2.1 contrast ratios and check compliance", () => {
      const maxRatio = calculateWcagContrastRatio("#ffffff", "#000000");
      expect(maxRatio).toBe(21.0);

      const sameRatio = calculateWcagContrastRatio("#ffffff", "#ffffff");
      expect(sameRatio).toBe(1.0);

      const darkBlueOnWhite = calculateWcagContrastRatio("#0f172a", "#ffffff");
      expect(darkBlueOnWhite).toBeGreaterThan(14.0);
      expect(isWcagAaCompliant(darkBlueOnWhite)).toBe(true);
      expect(isWcagAaaCompliant(darkBlueOnWhite)).toBe(true);

      const lowContrast = calculateWcagContrastRatio("#94a3b8", "#ffffff");
      expect(lowContrast).toBeLessThan(4.5);
      expect(isWcagAaCompliant(lowContrast)).toBe(false);
    });

    it("should calculate APCA lightness contrast (Lc) accurately", () => {
      const blackOnWhiteLc = calculateApcaContrast("#000000", "#ffffff");
      expect(blackOnWhiteLc).toBeGreaterThan(95);
      expect(isApcaCompliant(blackOnWhiteLc, "body")).toBe(true);
      expect(isApcaCompliant(blackOnWhiteLc, "fluent")).toBe(true);

      const whiteOnDarkLc = calculateApcaContrast("#ffffff", "#0b0f19");
      expect(Math.abs(whiteOnDarkLc)).toBeGreaterThan(95);
      expect(isApcaCompliant(whiteOnDarkLc, "body")).toBe(true);

      const lowContrastLc = calculateApcaContrast("#94a3b8", "#ffffff");
      expect(Math.abs(lowContrastLc)).toBeLessThan(60);
      expect(isApcaCompliant(lowContrastLc, "body")).toBe(false);
    });

    it("should sweep surface elements in early rounds using MathematicalContrastPreFilter", () => {
      const preFilter = new MathematicalContrastPreFilter();
      const report = preFilter.sweepSurface("light_standard-desktop", [
        {
          elementId: "heading-1",
          role: "headingText",
          foregroundColor: "#0f172a",
          backgroundColor: "#ffffff",
          isLargeText: true,
        },
        {
          elementId: "body-1",
          role: "bodyText",
          foregroundColor: "#475569",
          backgroundColor: "#ffffff",
        },
        {
          elementId: "failing-muted",
          role: "mutedText",
          foregroundColor: "#cbd5e1",
          backgroundColor: "#ffffff",
        },
      ]);

      expect(report.permutationId).toBe("light_standard-desktop");
      expect(report.auditedElementsCount).toBe(3);
      expect(report.passedCount).toBe(2);
      expect(report.failedCount).toBe(1);
      expect(report.allPassed).toBe(false);
    });
  });
});
