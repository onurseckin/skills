import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  AST_PURITY_REGEX_FALSE_POSITIVE,
  AstPurityEvaluationError,
  assertAstPurityEngineCompliance,
  auditDoctorAstPurityEngine,
  CANONICAL_AST_PURITY_ENGINE_PATH,
  countImmuneAstPatterns,
  createAstPurityDefectEntry,
  DEFECT_REF,
  isAstPurityImmuneNode,
  scanFileForAstPurityViolations,
  STANDARD_DOCTOR_AST_PURITY_MODULES,
  validateAstPurityWithoutRegexFalsePositives,
} from "../../../olt/scripts/src/validation/defect-doctor-ast-purity-test-regex-false-positive.ts";

describe("Task 1.10: defect-doctor-ast-purity-test-regex-false-positive", () => {
  test("1. defect constants and canonical paths are defined", () => {
    expect(DEFECT_REF).toBe("defect-doctor-ast-purity-test-regex-false-positive");
    expect(AST_PURITY_REGEX_FALSE_POSITIVE).toBe("AST_PURITY_REGEX_FALSE_POSITIVE");
    expect(CANONICAL_AST_PURITY_ENGINE_PATH).toBe(
      "olt/scripts/src/reporting/doctor/ast-purity-engine.ts",
    );
    expect(STANDARD_DOCTOR_AST_PURITY_MODULES).toContain(
      "olt/scripts/src/reporting/doctor/ast-purity-engine.ts",
    );
    expect(STANDARD_DOCTOR_AST_PURITY_MODULES).toContain(
      "tests/unit/doctor/ast-purity-engine.test.ts",
    );
  });

  test("2. AstPurityEvaluationError instantiates with defaults and custom options", () => {
    const defaultErr = new AstPurityEvaluationError("Purity evaluation failed");
    expect(defaultErr).toBeInstanceOf(Error);
    expect(defaultErr).toBeInstanceOf(AstPurityEvaluationError);
    expect(defaultErr.name).toBe("AstPurityEvaluationError");
    expect(defaultErr.code).toBe(AST_PURITY_REGEX_FALSE_POSITIVE);
    expect(defaultErr.defectRef).toBe(DEFECT_REF);
    expect(defaultErr.violations).toEqual([]);
    expect(defaultErr.issues).toEqual([]);

    const customErr = new AstPurityEvaluationError("Custom failure", {
      code: "CUSTOM_PURITY_ERR",
      defectRef: "custom-ref",
      filePath: "/src/test.ts",
      issues: ["Issue 1"],
      violations: [
        {
          filePath: "/src/test.ts",
          lineNumber: 5,
          columnNumber: 3,
          violationType: "EXPLICIT_ANY",
          nodeText: "any",
          message: "Explicit any",
        },
      ],
    });
    expect(customErr.code).toBe("CUSTOM_PURITY_ERR");
    expect(customErr.defectRef).toBe("custom-ref");
    expect(customErr.filePath).toBe("/src/test.ts");
    expect(customErr.issues).toEqual(["Issue 1"]);
    expect(customErr.violations).toHaveLength(1);
  });

  test("3. isAstPurityImmuneNode accurately detects string, template, and regex literals", () => {
    const source = 'const s = "any"; const t = `as any`; const r = /<any>/; const num = 42;';
    const sf = ts.createSourceFile("sample.ts", source, ts.ScriptTarget.Latest, true);
    const immuneNodes: ts.Node[] = [];
    const nonImmuneNodes: ts.Node[] = [];

    function check(node: ts.Node): void {
      if (isAstPurityImmuneNode(node)) immuneNodes.push(node);
      else nonImmuneNodes.push(node);
      ts.forEachChild(node, check);
    }
    check(sf);

    expect(immuneNodes.length).toBeGreaterThanOrEqual(3);
    expect(nonImmuneNodes.length).toBeGreaterThan(0);
  });

  test("4. countImmuneAstPatterns counts immune pattern occurrences in literals without flagging AST violations", () => {
    const codeWithImmuneStrings = `
      expect(content).not.toMatch(/:\s*any\b/);
      expect(code).not.toContain("as any");
      const pattern = \`Testing @ts-ignore immunity in \${filename}\`;
      const regexRef = /<any>/;
    `;
    const immuneCount = countImmuneAstPatterns(codeWithImmuneStrings);
    expect(immuneCount).toBeGreaterThanOrEqual(4);

    const violations = scanFileForAstPurityViolations("test.ts", codeWithImmuneStrings);
    expect(violations).toHaveLength(0);
  });

  test("5. scanFileForAstPurityViolations flags compiler suppression directives in comments", () => {
    const snippet = `
      // @ts-ignore
      const a = 1;
      /* @ts-expect-error suppress type */
      const b = 2;
      // @ts-nocheck
    `;
    const violations = scanFileForAstPurityViolations("suppressed.ts", snippet);
    expect(violations).toHaveLength(3);
    expect(violations.every((v) => v.violationType === "COMPILER_SUPPRESSION_DIRECTIVE")).toBe(
      true,
    );
    expect(violations[0]?.lineNumber).toBe(2);
    expect(violations[1]?.lineNumber).toBe(4);
    expect(violations[2]?.lineNumber).toBe(6);
  });

  test("6. scanFileForAstPurityViolations flags explicit any and any type assertions", () => {
    const snippet = `
      let x: any = 10;
      const y = x as any;
      const z = <any>x;
      function getPromise(): Promise<any> { return Promise.resolve(1); }
    `;
    const violations = scanFileForAstPurityViolations("any.ts", snippet);
    expect(violations.length).toBeGreaterThanOrEqual(4);
    const assertions = violations.filter((v) => v.violationType === "ANY_TYPE_ASSERTION");
    const explicit = violations.filter((v) => v.violationType === "EXPLICIT_ANY");
    expect(assertions.length).toBe(2);
    expect(explicit.length).toBeGreaterThanOrEqual(2);
  });

  test("7. validateAstPurityWithoutRegexFalsePositives validates canonical AST purity engine", () => {
    const result = validateAstPurityWithoutRegexFalsePositives();
    expect(result.defectRef).toBe(DEFECT_REF);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
    expect(result.immunePatternsFound).toBeGreaterThanOrEqual(0);
  });

  test("8. validateAstPurityWithoutRegexFalsePositives handles missing file paths gracefully", () => {
    const missing = validateAstPurityWithoutRegexFalsePositives("/nonexistent/file/path.ts");
    expect(missing.valid).toBe(false);
    expect(missing.issues[0]).toContain("File not found");
  });

  test("9. assertAstPurityEngineCompliance succeeds on pure code and throws AstPurityEvaluationError on violations", () => {
    const cleanCode = `export function add(a: number, b: number): number { return a + b; }`;
    expect(() => assertAstPurityEngineCompliance(cleanCode)).not.toThrow();

    const dirtyCode = `const bad = 1 as any;`;
    let thrownError: unknown;
    try {
      assertAstPurityEngineCompliance(dirtyCode);
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(AstPurityEvaluationError);
    if (thrownError instanceof AstPurityEvaluationError) {
      expect(thrownError.code).toBe(AST_PURITY_REGEX_FALSE_POSITIVE);
      expect(thrownError.violations.length).toBeGreaterThan(0);
    }
  });

  test("10. auditDoctorAstPurityEngine audits doctor module tree", () => {
    const audit = auditDoctorAstPurityEngine();
    expect(audit.defectRef).toBe(DEFECT_REF);
    expect(audit.errorCode).toBe(AST_PURITY_REGEX_FALSE_POSITIVE);
    expect(audit.resolved).toBe(true);
    expect(audit.totalFiles).toBeGreaterThanOrEqual(1);
    expect(audit.validFiles).toBe(audit.totalFiles);
    expect(audit.invalidFiles).toBe(0);
    expect(audit.totalViolations).toBe(0);
    expect(audit.issues).toHaveLength(0);
    expect(typeof audit.timestamp).toBe("string");
  });

  test("11. createAstPurityDefectEntry constructs structured DefectEntry matching contract", () => {
    const defaultEntry = createAstPurityDefectEntry();
    expect(defaultEntry.id).toContain(DEFECT_REF);
    expect(defaultEntry.domain).toBe("doctor-ast-purity");
    expect(defaultEntry.error_code).toBe(AST_PURITY_REGEX_FALSE_POSITIVE);
    expect(defaultEntry.status).toBe("resolved");
    expect(defaultEntry.type).toBe("DOCTOR_FINDING");
    expect(defaultEntry.category).toBe("code_defect");
    expect(defaultEntry.severity).toBe("high");
    expect(defaultEntry.context?.defectReference).toBe(DEFECT_REF);

    const customEntry = createAstPurityDefectEntry({
      id: "CUSTOM-DEFECT-99",
      filePath: "src/broken.ts",
      status: "open",
      severity: "critical",
      issues: ["Custom AST error"],
      observation: "Detected AST failure",
      remediation: "Fix AST violation",
    });
    expect(customEntry.id).toBe("CUSTOM-DEFECT-99");
    expect(customEntry.status).toBe("open");
    expect(customEntry.severity).toBe("critical");
    expect(customEntry.message).toBe("Custom AST error");
  });

  test("12. AST purity scanner confirms zero TypeScript any and zero compiler suppressions across write scope", () => {
    const filesToAudit = [
      resolve(
        process.cwd(),
        "olt/scripts/src/validation/defect-doctor-ast-purity-test-regex-false-positive.ts",
      ),
      resolve(
        process.cwd(),
        "tests/unit/validation/defect-doctor-ast-purity-test-regex-false-positive.test.ts",
      ),
    ];

    for (const filePath of filesToAudit) {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      const violations = scanFileForAstPurityViolations(filePath, content);
      expect(violations).toHaveLength(0);

      const validation = validateAstPurityWithoutRegexFalsePositives(content, { filePath });
      expect(validation.valid).toBe(true);
      expect(validation.violations).toHaveLength(0);
      expect(validation.issues).toHaveLength(0);
    }
  });
});
