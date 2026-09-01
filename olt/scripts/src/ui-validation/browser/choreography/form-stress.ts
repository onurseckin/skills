import { HarnessError } from "../../../core/errors/index.ts";
import { CANONICAL_STRESS_INPUTS, type CanonicalStressInputKey } from "./types.ts";
import type {
  FormFieldType,
  FormFieldDescriptor,
  ValidationBannerInfo,
  OverflowInspectionResult,
  FormStressFieldResult,
  FormStressTestPlan,
  FormStressTestResult,
  FormFieldEvaluationInput,
} from "./overlay-types.ts";
export class FormStressExplorer {
  /**
   * Generates boundary edge stress inputs appropriate for a given field descriptor
   */
  public generateStressInputs(
    field: FormFieldDescriptor,
  ): readonly { key: CanonicalStressInputKey; value: string }[] {
    if (!field || !field.fieldId || !field.type) {
      throw new HarnessError("INVALID_ARGUMENT", "Field descriptor must specify fieldId and type");
    }

    if (field.type === "number") {
      return [
        {
          key: "EXTREME_NUMBERS_MAX_SAFE",
          value: CANONICAL_STRESS_INPUTS.EXTREME_NUMBERS_MAX_SAFE,
        },
        {
          key: "EXTREME_NUMBERS_MIN_SAFE",
          value: CANONICAL_STRESS_INPUTS.EXTREME_NUMBERS_MIN_SAFE,
        },
        {
          key: "EXTREME_NUMBERS_EXPONENTIAL",
          value: CANONICAL_STRESS_INPUTS.EXTREME_NUMBERS_EXPONENTIAL,
        },
        {
          key: "EXTREME_NUMBERS_SUBTLE_FLOAT",
          value: CANONICAL_STRESS_INPUTS.EXTREME_NUMBERS_SUBTLE_FLOAT,
        },
        { key: "EMPTY", value: CANONICAL_STRESS_INPUTS.EMPTY },
      ];
    }

    if (field.type === "checkbox" || field.type === "radio") {
      return [{ key: "EMPTY", value: "" }];
    }

    // Default text/textarea/email/password inputs
    return [
      { key: "LONG_STRING_1000", value: CANONICAL_STRESS_INPUTS.LONG_STRING_1000 },
      { key: "UNICODE_EMOJIS", value: CANONICAL_STRESS_INPUTS.UNICODE_EMOJIS },
      { key: "RTL_SCRIPTS", value: CANONICAL_STRESS_INPUTS.RTL_SCRIPTS },
      { key: "SPECIAL_CHARS_INJECTION", value: CANONICAL_STRESS_INPUTS.SPECIAL_CHARS_INJECTION },
      { key: "ZERO_WIDTH_SPACES", value: CANONICAL_STRESS_INPUTS.ZERO_WIDTH_SPACES },
      { key: "EMPTY", value: CANONICAL_STRESS_INPUTS.EMPTY },
      { key: "WHITESPACE_ONLY", value: CANONICAL_STRESS_INPUTS.WHITESPACE_ONLY },
    ];
  }

  /**
   * Inspects element metrics for layout overflow and clipping
   */
  public inspectOverflow(
    scrollWidth: number,
    clientWidth: number,
    scrollHeight: number,
    clientHeight: number,
  ): OverflowInspectionResult {
    const horizontalOverflow = scrollWidth > clientWidth;
    const verticalOverflow = scrollHeight > clientHeight;
    const overflowDetected = horizontalOverflow || verticalOverflow;
    const textTruncated = horizontalOverflow;

    return {
      overflowDetected,
      horizontalOverflow,
      verticalOverflow,
      textTruncated,
      details: {
        scrollWidth,
        clientWidth,
        scrollHeight,
        clientHeight,
      },
    };
  }

  /**
   * Validates banner theme and ARIA attributes for accessibility
   */
  public validateBannerAccessibility(banner: ValidationBannerInfo): {
    valid: boolean;
    violations: readonly string[];
  } {
    const violations: string[] = [];

    if (banner.present) {
      if (!banner.ariaRole || !["alert", "status", "region"].includes(banner.ariaRole)) {
        violations.push(
          `Validation banner missing valid ARIA role (expected alert|status|region, found '${banner.ariaRole}')`,
        );
      }
      if (!banner.ariaLive || !["assertive", "polite"].includes(banner.ariaLive)) {
        violations.push(
          `Validation banner missing or invalid aria-live attribute (found '${banner.ariaLive}')`,
        );
      }
      if (banner.ariaDescribedByMatch === false) {
        violations.push("Input field aria-describedby does not match validation banner ID");
      }
      if (banner.contrastRatioValid === false) {
        violations.push("Validation banner contrast ratio fails WCAG 2.1 AA minimum requirement");
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Evaluates field stress test results
   */
  public evaluateFieldStressResults(
    evaluations: readonly FormFieldEvaluationInput[],
  ): FormStressTestResult {
    if (!evaluations || evaluations.length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "Evaluations list must not be empty");
    }

    const fieldResults: FormStressFieldResult[] = [];
    const overflowViolations: string[] = [];
    const ariaViolations: string[] = [];
    let passedTests = 0;
    let failedTests = 0;

    for (const evalItem of evaluations) {
      const violations: string[] = [];
      const overflow = this.inspectOverflow(
        evalItem.scrollWidth,
        evalItem.clientWidth,
        evalItem.scrollHeight,
        evalItem.clientHeight,
      );

      if (overflow.overflowDetected) {
        const overflowMsg = `Field '${evalItem.fieldId}' experienced overflow on input '${evalItem.inputKey}' (scrollWidth=${evalItem.scrollWidth} > clientWidth=${evalItem.clientWidth})`;
        violations.push(overflowMsg);
        overflowViolations.push(overflowMsg);
      }

      if (evalItem.validationBanner) {
        const a11y = this.validateBannerAccessibility(evalItem.validationBanner);
        if (!a11y.valid) {
          for (const v of a11y.violations) {
            violations.push(`Field '${evalItem.fieldId}' a11y issue: ${v}`);
            ariaViolations.push(`Field '${evalItem.fieldId}': ${v}`);
          }
        }
      }

      const passed = violations.length === 0;
      if (passed) {
        passedTests++;
      } else {
        failedTests++;
      }

      fieldResults.push({
        fieldId: evalItem.fieldId,
        inputKey: evalItem.inputKey,
        appliedValue: evalItem.value,
        accepted: evalItem.accepted,
        overflowDetected: overflow.overflowDetected,
        textTruncated: overflow.textTruncated,
        ...(evalItem.clientValidationError !== undefined
          ? { clientValidationError: evalItem.clientValidationError }
          : {}),
        ...(evalItem.validationBanner !== undefined
          ? { validationBanner: evalItem.validationBanner }
          : {}),
        violations,
      });
    }

    return {
      formId: evaluations[0]?.fieldId.split(".")[0] || "form",
      totalTests: evaluations.length,
      passedTests,
      failedTests,
      fieldResults,
      overflowViolations,
      ariaViolations,
      overallValid: failedTests === 0,
    };
  }
}

// ============================================================================
// 3. Overlay Orchestration & Z-Index Governance
// ============================================================================
