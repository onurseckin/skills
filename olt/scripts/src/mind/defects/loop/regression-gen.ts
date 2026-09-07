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
  readonly skipped?: boolean | undefined;
  readonly reason?: string | undefined;
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

export function resolveRegressionFilePathHint(category: string): string {
  switch (category) {
    case "boundary_violation":
      return "tests/regressions/boundary-regression.test.ts";
    case "model_reasoning_error":
      return "tests/regressions/reasoning-regression.test.ts";
    case "security_risk":
      return "tests/regressions/security-regression.test.ts";
    case "modularity_violation":
      return "tests/regressions/modularity-regression.test.ts";
    default:
      return "tests/regressions/code-defect-regression.test.ts";
  }
}

function isTautologicalAssertion(assertion: string): boolean {
  const trimmed = assertion.trim();
  if (trimmed === "") return true;
  if (/expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/.test(trimmed)) return true;
  if (/expect\(\s*false\s*\)\.toBe\(\s*false\s*\)/.test(trimmed)) return true;
  const trivialMatch =
    /expect\(\s*(['"]?)([^'"()]+)\1\s*\)\.to(?:Be|Equal|StrictEqual)\(\s*\1\2\1\s*\)/.exec(trimmed);
  if (trivialMatch !== null) return true;
  return false;
}

function canDefectYieldMeaningfulAssertion(defect: DefectEntry): boolean {
  if (defect.id === undefined || defect.id.trim() === "") return false;
  const hasObservation = defect.observation !== undefined && defect.observation.trim() !== "";
  const hasTitle = defect.title !== undefined && defect.title.trim() !== "";
  const hasDescription = defect.description !== undefined && defect.description.trim() !== "";
  const proof = defect.resolution ?? defect.resolution_proof;
  const hasValidProof =
    proof !== undefined &&
    proof !== null &&
    proof.test_assertion !== undefined &&
    !isTautologicalAssertion(proof.test_assertion);
  return hasObservation || hasTitle || hasDescription || hasValidProof;
}

export function generateDefectRegressionTest(
  defect: DefectEntry,
  _options?: { readonly includeComments?: boolean | undefined },
): GeneratedRegressionTest {
  const cat =
    defect.category !== undefined && defect.category !== ""
      ? (defect.category as DefectCategory)
      : categorizeDefect(defect);
  const filePathHint = resolveRegressionFilePathHint(cat);
  const defectType = defect.type !== undefined && defect.type !== "" ? defect.type : "defect";
  const testName = `regression [${defect.id}] ${cat} ${defectType}`;

  if (!canDefectYieldMeaningfulAssertion(defect)) {
    return {
      defect_id: defect.id ?? "",
      test_name: testName,
      category: cat,
      file_path_hint: filePathHint,
      test_code: "",
      verified_assertion: "",
      skipped: true,
      reason: "Defect lacks empirical observation or verifiable resolution proof",
    };
  }

  const observationText = defect.observation ?? defect.title ?? defect.description ?? "";
  const proof = defect.resolution ?? defect.resolution_proof;
  const hasProof = proof !== undefined && proof !== null;
  const proofVerificationValid = hasProof ? verifyResolutionProofEmpirical(proof).isValid : false;

  let assertion = `expect(verifiedCategory).toBe("${cat}");`;
  const lines: string[] = [];
  lines.push(`  test("${testName}", () => {`);
  lines.push(`    const verifiedCategory = categorizeDefect({`);
  lines.push(`      id: "${defect.id}",`);
  lines.push(`      type: "${defectType}",`);
  lines.push(`      observation: ${JSON.stringify(observationText)},`);
  if (defect.category !== undefined && defect.category !== "") {
    lines.push(`      category: "${defect.category}",`);
  }
  lines.push(`    });`);
  lines.push(`    ${assertion}`);

  if (hasProof && proofVerificationValid) {
    const proofJson = JSON.stringify(proof);
    lines.push(`    const proof = ${proofJson};`);
    lines.push(`    const verification = verifyResolutionProofEmpirical(proof);`);
    lines.push(`    expect(verification.isValid).toBe(true);`);
    assertion = "expect(verification.isValid).toBe(true);";
  }

  if (defect.status === "resolved" || defect.status === "completed") {
    lines.push(
      `    const records = readExistingDefectLog(resolveCanonicalCompletedDefectsPath());`,
    );
    lines.push(`    const persisted = records.find((entry) => entry.id === "${defect.id}");`);
    lines.push(`    if (persisted !== undefined) {`);
    lines.push(`      expect(persisted.status).toBe("${defect.status}");`);
    lines.push(`    }`);
  }

  lines.push(`  });`);
  const testBody = lines.join("\n");

  return {
    defect_id: defect.id,
    test_name: testName,
    category: cat,
    file_path_hint: filePathHint,
    test_code: testBody,
    verified_assertion: assertion,
    skipped: false,
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

  if (defects.length === 0) {
    return "";
  }

  const generated = defects.map((d) => generateDefectRegressionTest(d));
  const activeTests = generated.filter((g) => g.test_code.trim().length > 0);

  if (activeTests.length === 0) {
    return "";
  }

  const testBlocks = activeTests.map((g) => g.test_code).join("\n\n");

  return `import { describe, expect, test } from "bun:test";
import {
  categorizeDefect,
  readExistingDefectLog,
  resolveCanonicalCompletedDefectsPath,
  verifyResolutionProofEmpirical,
} from "../../olt/scripts/src/mind/defects/index.ts";

describe("${suiteName}", () => {
${testBlocks}
});
`;
}
