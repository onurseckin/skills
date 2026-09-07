import {
  describe,
  expect,
  it,
  BORDER_RADII,
  COLOR_PALETTES,
  SHADOW_ELEVATIONS,
  SPACING_TOKENS,
  TRANSITION_TOKENS,
  TYPOGRAPHY_TOKENS,
  VALID_BORDER_RADII_VALUES,
  VALID_FONT_SIZES,
  VALID_FONT_WEIGHTS,
  VALID_LINE_HEIGHTS,
  VALID_SPACING_VALUES,
  VALID_TRANSITION_DURATIONS,
  validateZeroRawValues,
} from "../fixtures.ts";

describe("Design System Tokens - Sovereign Constants & Raw Value Policy", () => {
  describe("1. Design System Token Sovereign Constants", () => {
    it("should provide canonical modular spacing scale tokens", () => {
      expect(SPACING_TOKENS.none).toBe(0);
      expect(SPACING_TOKENS["3xs"]).toBe(2);
      expect(SPACING_TOKENS["2xs"]).toBe(4);
      expect(SPACING_TOKENS.xs).toBe(8);
      expect(SPACING_TOKENS.sm).toBe(12);
      expect(SPACING_TOKENS.md).toBe(16);
      expect(SPACING_TOKENS.lg).toBe(24);
      expect(SPACING_TOKENS.xl).toBe(32);
      expect(SPACING_TOKENS["2xl"]).toBe(48);
      expect(SPACING_TOKENS["3xl"]).toBe(64);
      expect(SPACING_TOKENS["4xl"]).toBe(96);
      expect(SPACING_TOKENS["5xl"]).toBe(128);

      expect(VALID_SPACING_VALUES).toContain(16);
      expect(VALID_SPACING_VALUES).not.toContain(13);
      expect(VALID_SPACING_VALUES).not.toContain(17);
    });

    it("should provide typography tokens with font sizes, weights, and line heights", () => {
      expect(TYPOGRAPHY_TOKENS.fontFamilies.sans).toContain("Inter");
      expect(TYPOGRAPHY_TOKENS.fontFamilies.serif).toContain("Playfair Display");
      expect(TYPOGRAPHY_TOKENS.fontFamilies.mono).toContain("JetBrains Mono");

      expect(TYPOGRAPHY_TOKENS.fontSizes.xs).toBe(12);
      expect(TYPOGRAPHY_TOKENS.fontSizes.base).toBe(16);
      expect(TYPOGRAPHY_TOKENS.fontSizes["5xl"]).toBe(48);

      expect(VALID_FONT_SIZES).toContain(16);
      expect(VALID_FONT_SIZES).not.toContain(15);

      expect(VALID_FONT_WEIGHTS).toEqual([400, 500, 600, 700]);
      expect(VALID_LINE_HEIGHTS).toContain(1.5);
    });

    it("should provide semantic color palettes across light, dark, and high-contrast themes", () => {
      expect(COLOR_PALETTES.light.primary).toBe("#2563eb");
      expect(COLOR_PALETTES.light.background).toBe("#ffffff");
      expect(COLOR_PALETTES.light.surface).toBe("#f8fafc");

      expect(COLOR_PALETTES.dark.primary).toBe("#3b82f6");
      expect(COLOR_PALETTES.dark.background).toBe("#0b0f19");
      expect(COLOR_PALETTES.dark.surface).toBe("#111827");

      expect(COLOR_PALETTES["high-contrast"].background).toBe("#ffffff");
      expect(COLOR_PALETTES["high-contrast"].border).toBe("#000000");
    });

    it("should provide shadow elevations, border radii, and transition tokens", () => {
      expect(SHADOW_ELEVATIONS.none).toBe("none");
      expect(SHADOW_ELEVATIONS.md).toContain("rgba(0, 0, 0, 0.1)");
      expect(SHADOW_ELEVATIONS["2xl"]).toBeDefined();

      expect(BORDER_RADII.none).toBe(0);
      expect(BORDER_RADII.md).toBe(8);
      expect(BORDER_RADII.full).toBe(9999);
      expect(VALID_BORDER_RADII_VALUES).toContain(8);

      expect(TRANSITION_TOKENS.durations.instant).toBe(0);
      expect(TRANSITION_TOKENS.durations.fast).toBe(150);
      expect(VALID_TRANSITION_DURATIONS).toContain(250);
      expect(TRANSITION_TOKENS.easings.spring).toContain("cubic-bezier");
    });
  });

  describe("2. Zero Raw Value Policy & AST / Style Inspector", () => {
    it("should validate compliant style maps without violations", () => {
      const result = validateZeroRawValues({
        margin: "16px",
        padding: "24px",
        "font-size": "16px",
        "border-radius": "8px",
        color: "var(--color-text-primary)",
        "background-color": "#ffffff",
      });

      expect(result.valid).toBe(true);
      expect(result.violationCount).toBe(0);
      expect(result.violations.length).toBe(0);
    });

    it("should flag unauthorized raw pixel spacing and suggest nearest valid token", () => {
      const result = validateZeroRawValues({
        margin: "13px",
        "padding-top": "23px",
      });

      expect(result.valid).toBe(false);
      expect(result.violationCount).toBe(2);

      const marginViolation = result.violations.find((v) => v.property === "margin");
      expect(marginViolation).toBeDefined();
      expect(marginViolation?.violationType).toBe("unauthorized_pixel_value");
      expect(marginViolation?.recommendedToken).toContain("SPACING_TOKENS");
      expect(marginViolation?.recommendedToken).toContain("12px");

      const paddingViolation = result.violations.find((v) => v.property === "padding-top");
      expect(paddingViolation?.recommendedToken).toContain("24px");
    });

    it("should flag unauthorized raw hex colors", () => {
      const result = validateZeroRawValues({
        color: "#fa7268",
      });

      expect(result.valid).toBe(false);
      expect(result.violationCount).toBe(1);
      expect(result.violations[0]?.violationType).toBe("unauthorized_color");
      expect(result.violations[0]?.recommendedToken).toBe("COLOR_PALETTES[theme][role]");
    });

    it("should parse and validate raw string CSS with line tracking", () => {
      const css = `
        .card {
          margin: 17px;
          font-size: 15px;
          border-radius: 9px;
          background: #33aacc;
        }
      `;

      const result = validateZeroRawValues(css);
      expect(result.valid).toBe(false);
      expect(result.violationCount).toBeGreaterThanOrEqual(3);

      const marginV = result.violations.find((v) => v.property === "margin");
      expect(marginV?.line).toBe(3);
      expect(marginV?.recommendedToken).toContain("16px");
    });
  });
});
