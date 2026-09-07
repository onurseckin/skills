import {
  describe,
  expect,
  it,
  AestheticProfileEvaluator,
  TYPOGRAPHY_TOKENS,
  type UiDescriptor,
} from "../fixtures.ts";

describe("Aesthetic Profiles & Optical Dimensions", () => {
  describe("12. Eight Optical Dimensions & Industry Aesthetic Profiles", () => {
    it("should evaluate UI descriptor, detect descender clipping risks, and generate Socratic challenges", () => {
      const evaluator = new AestheticProfileEvaluator();

      const uiWithDescenderClipping: UiDescriptor = {
        viewName: "UserProfileView",
        theme: "light",
        elements: [
          {
            elementId: "badge-tag",
            tagName: "span",
            textContent: "Typography & Logging",
            boundingBox: { width: 120, height: 16, top: 10, left: 10 },
            computedStyles: {
              lineHeight: 1.0,
              overflow: "hidden",
              color: "#0f172a",
              backgroundColor: "#f8fafc",
            },
          },
          {
            elementId: "submit-btn",
            tagName: "button",
            isInteractive: true,
            boundingBox: { width: 32, height: 32, top: 50, left: 10 },
            computedStyles: {
              color: "#ffffff",
              backgroundColor: "#2563eb",
              padding: "16px",
            },
          },
        ],
      };

      const report = evaluator.evaluateUiDescriptor(
        uiWithDescenderClipping,
        "enterprise_accounting",
      );

      expect(report.passed).toBe(false);
      expect(report.violations.length).toBeGreaterThanOrEqual(2);

      const descenderViolation = report.violations.find((v) => v.dimension === "clipping-overflow");
      expect(descenderViolation).toBeDefined();
      expect(descenderViolation?.severity).toBe("critical");
      expect(descenderViolation?.message).toContain("descenders");

      const hitboxViolation = report.violations.find((v) => v.dimension === "touch-ergonomics");
      expect(hitboxViolation).toBeDefined();
      expect(hitboxViolation?.message).toContain("44x44px");

      expect(report.socraticChallenges.length).toBeGreaterThan(0);
      expect(report.socraticChallenges[0]?.inquiry).toContain("How might we elevate");
    });

    it("should enforce monospace / tabular numbers in Enterprise Tax & Accounting profile", () => {
      const evaluator = new AestheticProfileEvaluator();

      const ui: UiDescriptor = {
        viewName: "TaxLedgerView",
        theme: "light",
        elements: [
          {
            elementId: "revenue-figure",
            tagName: "td",
            textContent: "$1,234,567.89",
            isNumericReportData: true,
            boundingBox: { width: 120, height: 24, top: 10, left: 10 },
            computedStyles: {
              fontFamily: "Comic Sans MS, cursive",
              color: "#0f172a",
              backgroundColor: "#ffffff",
            },
          },
        ],
      };

      const report = evaluator.evaluateUiDescriptor(ui, "enterprise_accounting");
      const typoViolation = report.violations.find((v) => v.dimension === "typography-rendering");
      expect(typoViolation).toBeDefined();
      expect(typoViolation?.message).toContain("monospace or tabular-nums");
    });

    it("should enforce 48px touch targets and status color encoding in Fleet Telematics profile", () => {
      const evaluator = new AestheticProfileEvaluator();

      const ui: UiDescriptor = {
        viewName: "CockpitWidget",
        theme: "dark",
        elements: [
          {
            elementId: "emergency-override-btn",
            tagName: "button",
            isInteractive: true,
            boundingBox: { width: 44, height: 44, top: 10, left: 10 },
            computedStyles: {
              color: "#ffffff",
              backgroundColor: "#dc2626",
            },
          },
        ],
      };

      const report = evaluator.evaluateUiDescriptor(ui, "fleet_telematics");
      const touchViolation = report.violations.find((v) => v.dimension === "touch-ergonomics");
      expect(touchViolation).toBeDefined();
      expect(touchViolation?.message).toContain("48x48px");
    });

    it("should pass flawlessly for well-crafted compliant UI descriptor", () => {
      const evaluator = new AestheticProfileEvaluator();

      const compliantUi: UiDescriptor = {
        viewName: "CompliantAccountingSummary",
        theme: "light",
        elements: [
          {
            elementId: "total-balance",
            tagName: "td",
            textContent: "$54,321.00",
            isNumericReportData: true,
            boundingBox: { width: 150, height: 28, top: 10, left: 10 },
            computedStyles: {
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilies.mono,
              fontSize: "16px",
              lineHeight: 1.5,
              color: "#0f172a",
              backgroundColor: "#ffffff",
              padding: "12px",
            },
          },
          {
            elementId: "export-btn",
            tagName: "button",
            isInteractive: true,
            boundingBox: { width: 120, height: 48, top: 50, left: 10 },
            computedStyles: {
              fontSize: "14px",
              lineHeight: 1.5,
              color: "#ffffff",
              backgroundColor: "#2563eb",
              padding: "16px",
            },
          },
        ],
      };

      const report = evaluator.evaluateUiDescriptor(compliantUi, "enterprise_accounting");
      expect(report.passed).toBe(true);
      expect(report.overallScore).toBeGreaterThanOrEqual(85);
      expect(report.violations.length).toBe(0);
      expect(report.socraticChallenges.length).toBe(0);
    });
  });
});
