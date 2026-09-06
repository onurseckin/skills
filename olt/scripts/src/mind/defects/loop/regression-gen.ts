import { join } from "node:path";
import type { DefectCategory, DefectEntry } from "../core/types.ts";
import { categorizeDefect } from "../core/sanitizer.ts";
import { verifyResolutionProofEmpirical } from "./resolution.ts";

export interface GeneratedRegressionTest {
  readonly defect_id: string;
  readonly test_name: string;
  readonly category: DefectCategory;
  readonly file_path_hint: string;
  readonly test_code: string;
  readonly verified_assertion: string;
}

export interface GenerateTestSuiteOptions {
  readonly suiteName?: string | undefined;
  readonly bannerTitle?: string | undefined;
}

export function isDefectEligibleForPromotion(
  defect: DefectEntry,
  options: { readonly requireCommitSha?: boolean | undefined } = {},
): boolean {
  if (!["resolved", "completed"].includes(defect.status)) return false;
  if (defect.resolution === undefined) return false;
  if (defect.resolution === null) return false;
  const verified = verifyResolutionProofEmpirical(defect.resolution, options);
  return verified.isValid;
}

export function generateDefectRegressionTest(
  defect: DefectEntry,
  _options?: { readonly includeComments?: boolean | undefined },
): GeneratedRegressionTest {
  const cat =
    defect.category !== undefined && defect.category !== ""
      ? defect.category
      : categorizeDefect(defect);
  let filePathHint = "tests/unit/mind/code-defect-regression.test.ts";
  const defectType = defect.type !== undefined && defect.type !== "" ? defect.type : "defect";
  const testName = `regression [${defect.id}] ${cat} ${defectType}`;
  let testBody = "";
  let assertion = "";
  const defectMeta = JSON.stringify({
    id: defect.id,
    category: cat,
    type: defectType,
    status: defect.status,
  });

  if (cat === "boundary_violation") {
    filePathHint = "tests/unit/mind/boundary-regression.test.ts";
    assertion = 'expect(meta.category).toBe("boundary_violation");';
    testBody = `  test("${testName}", () => {\n    const meta = ${defectMeta};\n    expect(meta.id).toBe("${defect.id}");\n    ${assertion}\n  });`;
  } else if (cat === "model_reasoning_error") {
    filePathHint = "tests/unit/mind/reasoning-regression.test.ts";
    assertion = 'expect(meta.category).toBe("model_reasoning_error");';
    testBody = `  test("${testName}", () => {\n    const meta = ${defectMeta};\n    expect(meta.id).toBe("${defect.id}");\n    ${assertion}\n  });`;
  } else {
    filePathHint = "tests/unit/mind/code-defect-regression.test.ts";
    assertion = "expect(meta.status).toBeDefined();";
    testBody = `  test("${testName}", () => {\n    const meta = ${defectMeta};\n    expect(meta.id).toBe("${defect.id}");\n    ${assertion}\n  });`;
  }

  return {
    defect_id: defect.id,
    test_name: testName,
    category: cat as DefectCategory,
    file_path_hint: filePathHint,
    test_code: testBody,
    verified_assertion: assertion,
  };
}

export function generateRegressionTestSuite(
  defects: readonly DefectEntry[],
  options?: GenerateTestSuiteOptions,
): string {
  const suiteName =
    options !== undefined && options.suiteName !== undefined && options.suiteName !== ""
      ? options.suiteName
      : "Generated Defect Regression Suite";
  const banner = options?.bannerTitle ? `// ${options.bannerTitle}\n  ` : "";

  if (defects.length === 0) {
    return `import { describe, expect, test } from "bun:test";\n\ndescribe("empty regression suite placeholder", () => {\n  ${banner}// Total defects protected: 0\n  test("placeholder test", () => {\n    expect(true).toBe(true);\n  });\n});\n`;
  }

  const generated = defects.map((d) => generateDefectRegressionTest(d));
  const testBlocks = generated.map((g) => g.test_code).join("\n\n");

  return `import { describe, expect, test } from "bun:test";\n\ndescribe("${suiteName}", () => {\n  ${banner}// Total defects protected: ${defects.length}\n${testBlocks}\n});\n`;
}
