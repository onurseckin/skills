import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  CANONICAL_STRESS_INPUTS,
  FormStressExplorer,
  resetDefaultBrowserChoreographyEngine,
  type FormFieldDescriptor,
} from "../fixtures.ts";

describe("Browser Choreography - Forms & Responsive Reflow", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  describe("Dynamic Form Exploration & Stress Testing", () => {
    it("generates canonical stress inputs for text and number fields", () => {
      const explorer = new FormStressExplorer();
      const textField: FormFieldDescriptor = {
        fieldId: "username",
        selector: "input#username",
        type: "text",
      };
      const numField: FormFieldDescriptor = {
        fieldId: "amount",
        selector: "input#amount",
        type: "number",
      };
      const checkField: FormFieldDescriptor = {
        fieldId: "terms",
        selector: "input#terms",
        type: "checkbox",
      };

      const textInputs = explorer.generateStressInputs(textField);
      expect(textInputs.some((i) => i.key === "LONG_STRING_1000")).toBe(true);
      expect(textInputs.some((i) => i.key === "UNICODE_EMOJIS")).toBe(true);
      expect(textInputs.some((i) => i.key === "RTL_SCRIPTS")).toBe(true);
      expect(textInputs.some((i) => i.key === "SPECIAL_CHARS_INJECTION")).toBe(true);
      expect(textInputs.some((i) => i.key === "ZERO_WIDTH_SPACES")).toBe(true);
      expect(textInputs.some((i) => i.key === "EMPTY")).toBe(true);
      expect(textInputs.some((i) => i.key === "WHITESPACE_ONLY")).toBe(true);

      const numInputs = explorer.generateStressInputs(numField);
      expect(numInputs.some((i) => i.key === "EXTREME_NUMBERS_MAX_SAFE")).toBe(true);
      expect(numInputs.some((i) => i.key === "EXTREME_NUMBERS_EXPONENTIAL")).toBe(true);

      const checkInputs = explorer.generateStressInputs(checkField);
      expect(checkInputs.length).toBe(1);
    });

    it("inspects overflow metrics accurately", () => {
      const explorer = new FormStressExplorer();
      const normal = explorer.inspectOverflow(100, 120, 30, 40);
      expect(normal.overflowDetected).toBe(false);
      expect(normal.horizontalOverflow).toBe(false);

      const overflow = explorer.inspectOverflow(350, 200, 30, 30);
      expect(overflow.overflowDetected).toBe(true);
      expect(overflow.horizontalOverflow).toBe(true);
      expect(overflow.textTruncated).toBe(true);
    });

    it("validates banner theme and ARIA accessibility", () => {
      const explorer = new FormStressExplorer();
      const validBanner = {
        present: true,
        message: "Field required",
        theme: "error" as const,
        ariaRole: "alert",
        ariaLive: "assertive" as const,
        ariaDescribedByMatch: true,
        contrastRatioValid: true,
      };
      const validRes = explorer.validateBannerAccessibility(validBanner);
      expect(validRes.valid).toBe(true);
      expect(validRes.violations.length).toBe(0);

      const badBanner = {
        present: true,
        message: "Invalid input",
        ariaRole: "button",
        ariaLive: "off" as const,
        ariaDescribedByMatch: false,
        contrastRatioValid: false,
      };
      const badRes = explorer.validateBannerAccessibility(badBanner);
      expect(badRes.valid).toBe(false);
      expect(badRes.violations.length).toBe(4);
    });

    it("evaluates comprehensive field stress results", () => {
      const explorer = new FormStressExplorer();
      const evaluations = [
        {
          fieldId: "user-profile.name",
          inputKey: "LONG_STRING_1000",
          value: CANONICAL_STRESS_INPUTS.LONG_STRING_1000,
          scrollWidth: 500,
          clientWidth: 300,
          scrollHeight: 30,
          clientHeight: 30,
          accepted: true,
        },
        {
          fieldId: "user-profile.email",
          inputKey: "SPECIAL_CHARS_INJECTION",
          value: CANONICAL_STRESS_INPUTS.SPECIAL_CHARS_INJECTION,
          scrollWidth: 200,
          clientWidth: 250,
          scrollHeight: 30,
          clientHeight: 30,
          accepted: false,
          validationBanner: {
            present: true,
            message: "Invalid email format",
            theme: "error" as const,
            ariaRole: "alert",
            ariaLive: "assertive" as const,
            ariaDescribedByMatch: true,
            contrastRatioValid: true,
          },
        },
      ];

      const report = explorer.evaluateFieldStressResults(evaluations);
      expect(report.totalTests).toBe(2);
      expect(report.failedTests).toBe(1);
      expect(report.passedTests).toBe(1);
      expect(report.overflowViolations.length).toBe(1);
      expect(report.overallValid).toBe(false);
    });

    it("throws HarnessError on invalid form stress inputs", () => {
      const explorer = new FormStressExplorer();
      expect(() => explorer.generateStressInputs(null as unknown as FormFieldDescriptor)).toThrow(
        HarnessError,
      );
      expect(() => explorer.evaluateFieldStressResults([])).toThrow(HarnessError);
    });
  });
});
