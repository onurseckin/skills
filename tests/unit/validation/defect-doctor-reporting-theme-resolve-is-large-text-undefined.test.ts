import { describe, expect, test } from "bun:test";
import {
  assertThemeEvaluationSymbolsPurity,
  auditThemeEvaluationModule,
  CANONICAL_THEME_EVALUATION_MODULE_PATH,
  createThemeEvaluationDefectEntry,
  DEFECT_REF,
  evaluateContrast,
  extractDeclaredSymbols,
  LARGE_TEXT_BOLD_FONT_SIZE_PT,
  LARGE_TEXT_FONT_SIZE_PT,
  LARGE_TEXT_WCAG_AA_THRESHOLD,
  LARGE_TEXT_WCAG_AAA_THRESHOLD,
  NORMAL_TEXT_WCAG_AA_THRESHOLD,
  NORMAL_TEXT_WCAG_AAA_THRESHOLD,
  REQUIRED_THEME_EVALUATION_SYMBOLS,
  resolveIsLargeText,
  ThemeEvaluationSymbolError,
  UNDEFINED_SYMBOL_IN_THEME_EVALUATION,
  validateThemeEvaluationSymbols,
} from "../../../olt/scripts/src/validation/defect-doctor-reporting-theme-resolve-is-large-text-undefined.ts";

describe("Task 1.6: defect-doctor-reporting-theme-resolve-is-large-text-undefined", () => {
  test("1. defect constants, thresholds, and symbol definitions are accurately specified", () => {
    expect(DEFECT_REF).toBe("defect-doctor-reporting-theme-resolve-is-large-text-undefined");
    expect(UNDEFINED_SYMBOL_IN_THEME_EVALUATION).toBe("UNDEFINED_SYMBOL_IN_THEME_EVALUATION");
    expect(CANONICAL_THEME_EVALUATION_MODULE_PATH).toBe("olt/scripts/src/reporting/theme/evaluation.ts");
    expect(LARGE_TEXT_FONT_SIZE_PT).toBe(18);
    expect(LARGE_TEXT_BOLD_FONT_SIZE_PT).toBe(14);
    expect(NORMAL_TEXT_WCAG_AA_THRESHOLD).toBe(4.5);
    expect(LARGE_TEXT_WCAG_AA_THRESHOLD).toBe(3.0);
    expect(NORMAL_TEXT_WCAG_AAA_THRESHOLD).toBe(7.0);
    expect(LARGE_TEXT_WCAG_AAA_THRESHOLD).toBe(4.5);
    expect(REQUIRED_THEME_EVALUATION_SYMBOLS).toContain("resolveIsLargeText");
    expect(REQUIRED_THEME_EVALUATION_SYMBOLS).toContain("evaluateThemeContrastMatrix");
  });

  test("2. ThemeEvaluationSymbolError instantiates with default and custom options", () => {
    const defaultErr = new ThemeEvaluationSymbolError("Missing symbol in evaluation");
    expect(defaultErr).toBeInstanceOf(Error);
    expect(defaultErr).toBeInstanceOf(ThemeEvaluationSymbolError);
    expect(defaultErr.name).toBe("ThemeEvaluationSymbolError");
    expect(defaultErr.code).toBe(UNDEFINED_SYMBOL_IN_THEME_EVALUATION);
    expect(defaultErr.defectRef).toBe(DEFECT_REF);
    expect(defaultErr.symbolName).toBeUndefined();

    const customErr = new ThemeEvaluationSymbolError("Custom failure", {
      code: "CUSTOM_SYM_ERR",
      defectRef: "custom-ref",
      symbolName: "resolveIsLargeText",
      filePath: "/path/to/eval.ts",
      issues: ["Issue 1"],
    });
    expect(customErr.code).toBe("CUSTOM_SYM_ERR");
    expect(customErr.defectRef).toBe("custom-ref");
    expect(customErr.symbolName).toBe("resolveIsLargeText");
    expect(customErr.filePath).toBe("/path/to/eval.ts");
    expect(customErr.issues).toEqual(["Issue 1"]);
  });

  test("3. resolveIsLargeText correctly evaluates WCAG 2.1 font size and weight thresholds", () => {
    // Normal text unbold
    expect(resolveIsLargeText(12, false)).toBe(false);
    expect(resolveIsLargeText(16, false)).toBe(false);
    expect(resolveIsLargeText(17.9, false)).toBe(false);

    // Large text unbold (>= 18pt)
    expect(resolveIsLargeText(18, false)).toBe(true);
    expect(resolveIsLargeText(24, false)).toBe(true);
    expect(resolveIsLargeText(32)).toBe(true);

    // Large text bold (>= 14pt with isBold = true)
    expect(resolveIsLargeText(14, true)).toBe(true);
    expect(resolveIsLargeText(16, true)).toBe(true);
    expect(resolveIsLargeText(18, true)).toBe(true);

    // Below 14pt bold
    expect(resolveIsLargeText(12, true)).toBe(false);
    expect(resolveIsLargeText(13.9, true)).toBe(false);

    // Boundary and invalid cases
    expect(resolveIsLargeText(0, false)).toBe(false);
    expect(resolveIsLargeText(-5, true)).toBe(false);
    expect(resolveIsLargeText(Number.NaN, false)).toBe(false);
  });

  test("4. evaluateContrast evaluates WCAG AA and AAA standards with large text rules", () => {
    // High contrast black on white passes normal AA and AAA
    const highContrast = evaluateContrast("#000000", "#ffffff", 12, false);
    expect(highContrast.passed).toBe(true);
    expect(highContrast.isLargeText).toBe(false);
    expect(highContrast.contrastRatio).toBeGreaterThan(20);
    expect(highContrast.requiredThreshold).toBe(4.5);

    // Mid gray on white (~3.55:1) fails normal AA (4.5), but passes large AA (3.0)
    const midGrayNormal = evaluateContrast({
      foreground: "#888888",
      background: "#ffffff",
      fontSizePt: 12,
      isBold: false,
    });
    expect(midGrayNormal.isLargeText).toBe(false);
    expect(midGrayNormal.passed).toBe(false);
    expect(midGrayNormal.requiredThreshold).toBe(4.5);

    const midGrayLarge = evaluateContrast({
      foreground: "#888888",
      background: "#ffffff",
      fontSizePt: 18,
      isBold: false,
    });
    expect(midGrayLarge.isLargeText).toBe(true);
    expect(midGrayLarge.passed).toBe(true);
    expect(midGrayLarge.requiredThreshold).toBe(3.0);

    const midGrayBold = evaluateContrast("#888888", "#ffffff", 14, true);
    expect(midGrayBold.isLargeText).toBe(true);
    expect(midGrayBold.passed).toBe(true);

    // AAA standard check
    const midGrayAaaLarge = evaluateContrast({
      foreground: "#888888",
      background: "#ffffff",
      fontSizePt: 18,
      isBold: false,
      standard: "wcag-aaa",
    });
    expect(midGrayAaaLarge.requiredThreshold).toBe(4.5);
    expect(midGrayAaaLarge.passed).toBe(false); // ~3.55 < 4.5
  });

  test("5. extractDeclaredSymbols parses function, const, and export block symbols", () => {
    const snippet = `
      export function resolveIsLargeText(size: number): boolean { return size >= 18; }
      export async function evaluateSingleStandard() {}
      const helperConst = 42;
      export { getRequiredThreshold, evaluateThemeContrastMatrix as matrixEval };
    `;
    const symbols = extractDeclaredSymbols(snippet);
    expect(symbols).toContain("resolveIsLargeText");
    expect(symbols).toContain("evaluateSingleStandard");
    expect(symbols).toContain("helperConst");
    expect(symbols).toContain("getRequiredThreshold");
    expect(symbols).toContain("evaluateThemeContrastMatrix");
    expect(extractDeclaredSymbols("")).toEqual([]);
  });

  test("6. validateThemeEvaluationSymbols validates canonical evaluation.ts module successfully", () => {
    const result = validateThemeEvaluationSymbols();
    expect(result.defectRef).toBe(DEFECT_REF);
    expect(result.valid).toBe(true);
    expect(result.hasResolveIsLargeText).toBe(true);
    expect(result.missingSymbols).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.exportedSymbols).toContain("resolveIsLargeText");
    expect(result.exportedSymbols).toContain("evaluateThemeContrastMatrix");
  });

  test("7. validateThemeEvaluationSymbols detects missing symbols in incomplete source and handles missing files", () => {
    const incompleteSource = `
      export function getRequiredThreshold() {}
      export function evaluateSingleStandard() {}
    `;
    const result = validateThemeEvaluationSymbols(incompleteSource);
    expect(result.valid).toBe(false);
    expect(result.hasResolveIsLargeText).toBe(false);
    expect(result.missingSymbols).toContain("resolveIsLargeText");
    expect(result.missingSymbols).toContain("evaluateThemeContrastMatrix");
    expect(result.issues.length).toBeGreaterThan(0);

    const nonExistentResult = validateThemeEvaluationSymbols("/nonexistent/theme/evaluation.ts");
    expect(nonExistentResult.valid).toBe(false);
    expect(nonExistentResult.issues[0]).toContain("File not found");
  });

  test("8. assertThemeEvaluationSymbolsPurity passes on valid module and throws on missing symbols", () => {
    expect(() => assertThemeEvaluationSymbolsPurity()).not.toThrow();

    const brokenSource = `export function onlyOneSymbol() {}`;
    let thrownError: unknown;
    try {
      assertThemeEvaluationSymbolsPurity(brokenSource);
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(ThemeEvaluationSymbolError);
    if (thrownError instanceof ThemeEvaluationSymbolError) {
      expect(thrownError.code).toBe(UNDEFINED_SYMBOL_IN_THEME_EVALUATION);
      expect(thrownError.defectRef).toBe(DEFECT_REF);
      expect(thrownError.symbolName).toBe("resolveIsLargeText");
    }
  });

  test("9. auditThemeEvaluationModule performs live audit and sample contrast evaluations", () => {
    const audit = auditThemeEvaluationModule();
    expect(audit.defectRef).toBe(DEFECT_REF);
    expect(audit.resolved).toBe(true);
    expect(audit.targetFile).toContain("evaluation.ts");
    expect(audit.symbolValidation.valid).toBe(true);
    expect(audit.verifiedSymbols).toEqual(REQUIRED_THEME_EVALUATION_SYMBOLS);
    expect(audit.sampleEvaluations.normalTextPassed).toBe(true);
    expect(audit.sampleEvaluations.largeTextPassed).toBe(true);
    expect(audit.sampleEvaluations.largeTextBoldPassed).toBe(true);
    expect(audit.issues).toEqual([]);
    expect(typeof audit.timestamp).toBe("string");
  });

  test("10. createThemeEvaluationDefectEntry constructs structured DefectEntry with metadata", () => {
    const defaultEntry = createThemeEvaluationDefectEntry();
    expect(defaultEntry.domain).toBe("doctor-theme-evaluation");
    expect(defaultEntry.error_code).toBe(UNDEFINED_SYMBOL_IN_THEME_EVALUATION);
    expect(defaultEntry.category).toBe("code_defect");
    expect(defaultEntry.type).toBe("DOCTOR_FINDING");
    expect(defaultEntry.status).toBe("resolved");
    expect(defaultEntry.severity).toBe("high");
    expect(defaultEntry.title).toContain("resolveIsLargeText");
    expect(defaultEntry.context?.defectReference).toBe(DEFECT_REF);

    const customEntry = createThemeEvaluationDefectEntry({
      id: "CUSTOM-DEFECT-123",
      missingSymbol: "customSymbol",
      status: "open",
      severity: "critical",
      observation: "Custom observed error",
      remediation: "Custom remediation steps",
    });
    expect(customEntry.id).toBe("CUSTOM-DEFECT-123");
    expect(customEntry.status).toBe("open");
    expect(customEntry.severity).toBe("critical");
    expect(customEntry.title).toContain("customSymbol");
    expect(customEntry.observation).toBe("Custom observed error");
    expect(customEntry.remediation).toBe("Custom remediation steps");
  });
});
