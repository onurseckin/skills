import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFECT_REF,
  ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR,
  HtmlReporterSyntaxError,
  TS1127_ERROR_CODE,
  TS1136_ERROR_CODE,
  TS1160_ERROR_CODE,
  assertHtmlReporterSyntaxPurity,
  auditHtmlReporterDirectory,
  createHtmlReporterSyntaxDefectEntry,
  detectHtmlReporterSyntaxErrors,
  sanitizeHtmlReporterSource,
  validateHtmlReporterSyntax,
} from "../../../olt/scripts/src/validation/defect-html-reporter-escaped-backtick-unterminated-literal.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = join(
    tmpdir(),
    `html-reporter-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

describe("Task 1.3: defect-html-reporter-escaped-backtick-unterminated-literal", () => {
  test("1. constants export verified", () => {
    expect(DEFECT_REF).toBe("defect-html-reporter-escaped-backtick-unterminated-literal");
    expect(ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR).toBe("ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR");
    expect(TS1160_ERROR_CODE).toBe("TS1160");
    expect(TS1127_ERROR_CODE).toBe("TS1127");
    expect(TS1136_ERROR_CODE).toBe("TS1136");
  });

  test("2. detectHtmlReporterSyntaxErrors returns empty array on clean reporter template", () => {
    const clean = `
      export function getClientScript(payload: string): string {
        return \`const data = \${payload}; console.log(data);\`;
      }
    `;
    const issues = detectHtmlReporterSyntaxErrors(clean, "client-script.ts");
    expect(issues).toEqual([]);
  });

  test("3. detectHtmlReporterSyntaxErrors identifies TS1160 unterminated template literal", () => {
    const broken = "export function render() {\n  return `<div>Unterminated\n}";
    const issues = detectHtmlReporterSyntaxErrors(broken, "render.ts");
    expect(issues.length).toBeGreaterThan(0);
    const ts1160 = issues.find((i) => i.code === TS1160_ERROR_CODE);
    expect(ts1160).toBeDefined();
    expect(ts1160?.filePath).toBe("render.ts");
    expect(ts1160?.line).toBeGreaterThan(0);
  });

  test("4. detectHtmlReporterSyntaxErrors identifies TS1127 invalid character on stray backticks", () => {
    const stray = "const template = \\`hello\\`;";
    const issues = detectHtmlReporterSyntaxErrors(stray, "stray.ts");
    expect(issues.length).toBeGreaterThan(0);
    const hasSyntaxIssue = issues.some(
      (i) => i.code === TS1127_ERROR_CODE || i.code === TS1160_ERROR_CODE,
    );
    expect(hasSyntaxIssue).toBe(true);
  });

  test("5. detectHtmlReporterSyntaxErrors identifies TS1136 / syntax errors in broken interpolation", () => {
    const brokenInterp = "const s = `result: ${1 +`;";
    const issues = detectHtmlReporterSyntaxErrors(brokenInterp, "interp.ts");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.line).toBe(1);
    expect(issues[0]?.snippet).toContain("result:");
  });

  test("6. validateHtmlReporterSyntax passes on valid reporter code with clean flags", () => {
    const validSrc = "export function render(): string {\n  return `<div>OK</div>`;\n}";
    const res = validateHtmlReporterSyntax(validSrc, "valid.ts");
    expect(res.valid).toBe(true);
    expect(res.defectRef).toBe(DEFECT_REF);
    expect(res.filePath).toBe("valid.ts");
    expect(res.issueCount).toBe(0);
    expect(res.hasUnterminatedLiterals).toBe(false);
    expect(res.hasInvalidCharacters).toBe(false);
  });

  test("7. validateHtmlReporterSyntax fails with diagnostic flags on unclosed template", () => {
    const invalidSrc = "const msg = `hello world";
    const res = validateHtmlReporterSyntax(invalidSrc, "invalid.ts");
    expect(res.valid).toBe(false);
    expect(res.hasUnterminatedLiterals).toBe(true);
    expect(res.issueCount).toBeGreaterThan(0);
    expect(res.issues[0]?.code).toBe(TS1160_ERROR_CODE);
  });

  test("8. sanitizeHtmlReporterSource normalizes escaped backticks in return statement", () => {
    const corrupted = "export function render() {\n  return \\`<div>hello</div>\\`;\n}";
    const sanitized = sanitizeHtmlReporterSource(corrupted);
    expect(sanitized).toContain("return `<div>hello</div>`;");
    const val = validateHtmlReporterSyntax(sanitized);
    expect(val.valid).toBe(true);
  });

  test("9. sanitizeHtmlReporterSource normalizes escaped backticks in variable assignments and parens", () => {
    const corrupted = 'const x = \\`<div class="box"></div>\\`;';
    const sanitized = sanitizeHtmlReporterSource(corrupted);
    expect(sanitized).toBe('const x = `<div class="box"></div>`;');
    const val = validateHtmlReporterSyntax(sanitized);
    expect(val.valid).toBe(true);
  });

  test("10. sanitizeHtmlReporterSource closes unterminated template literal before block closure", () => {
    const corrupted = "export function render() {\n  return `<div>hello\n}\n";
    const sanitized = sanitizeHtmlReporterSource(corrupted);
    expect(sanitized).toContain("`;");
    const val = validateHtmlReporterSyntax(sanitized);
    expect(val.valid).toBe(true);
  });

  test("11. sanitizeHtmlReporterSource is idempotent on clean source", () => {
    const clean = "export function render() {\n  return `<div>hello ${10}</div>`;\n}";
    const sanitized = sanitizeHtmlReporterSource(clean);
    expect(sanitized).toBe(clean);
    expect(validateHtmlReporterSyntax(sanitized).valid).toBe(true);
  });

  test("12. assertHtmlReporterSyntaxPurity does not throw on pure syntax source", () => {
    const clean = "export const template = `<span>Purity Test</span>`;";
    expect(() => assertHtmlReporterSyntaxPurity(clean, "pure.ts")).not.toThrow();
  });

  test("13. assertHtmlReporterSyntaxPurity throws HtmlReporterSyntaxError on impure syntax", () => {
    const broken = "const template = `unclosed template string";
    expect(() => assertHtmlReporterSyntaxPurity(broken, "impure.ts")).toThrow(
      HtmlReporterSyntaxError,
    );
  });

  test("14. HtmlReporterSyntaxError encapsulates code, issues, and filePath correctly", () => {
    const issue = {
      code: TS1160_ERROR_CODE,
      message: "Unterminated literal",
      line: 4,
      column: 10,
      filePath: "test.ts",
    };
    const err = new HtmlReporterSyntaxError(
      "Failed validation",
      [issue],
      TS1160_ERROR_CODE,
      "test.ts",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HtmlReporterSyntaxError);
    expect(err.name).toBe("HtmlReporterSyntaxError");
    expect(err.code).toBe(TS1160_ERROR_CODE);
    expect(err.filePath).toBe("test.ts");
    expect(err.issues).toHaveLength(1);
  });

  test("15. auditHtmlReporterDirectory audits real scripts/testing/reporting/html directory successfully", () => {
    const targetDir = join(process.cwd(), "scripts/testing/reporting/html");
    const audit = auditHtmlReporterDirectory(targetDir);
    expect(audit.compliant).toBe(true);
    expect(audit.summary.defectRef).toBe(DEFECT_REF);
    expect(audit.summary.totalFiles).toBeGreaterThanOrEqual(4);
    expect(audit.summary.validFiles).toBe(audit.summary.totalFiles);
    expect(audit.summary.invalidFiles).toBe(0);
    expect(audit.summary.totalIssues).toBe(0);
  });

  test("16. auditHtmlReporterDirectory detects errors and reports non-compliant in temp directory with corrupt file", () => {
    const tempDir = createTempDir();
    writeFileSync(join(tempDir, "valid.ts"), "export const a = `ok`;\n", "utf-8");
    writeFileSync(join(tempDir, "broken.ts"), "export const b = `unterminated;\n", "utf-8");

    const audit = auditHtmlReporterDirectory(tempDir);
    expect(audit.compliant).toBe(false);
    expect(audit.summary.totalFiles).toBe(2);
    expect(audit.summary.validFiles).toBe(1);
    expect(audit.summary.invalidFiles).toBe(1);
    expect(audit.summary.totalIssues).toBeGreaterThan(0);
  });

  test("17. createHtmlReporterSyntaxDefectEntry generates valid structured DefectEntry", () => {
    const entry = createHtmlReporterSyntaxDefectEntry({
      filePath: "scripts/testing/reporting/html/styles.ts",
      issues: [
        {
          code: TS1160_ERROR_CODE,
          message: "Unterminated literal",
          line: 12,
          column: 5,
          filePath: "styles.ts",
        },
      ],
    });
    expect(entry.id).toContain(DEFECT_REF);
    expect(entry.domain).toBe("html-reporter-syntax");
    expect(entry.error_code).toBe(TS1160_ERROR_CODE);
    expect(entry.status).toBe("open");
    expect(entry.type).toBe("CODE_HEALTH");
    expect(entry.category).toBe("code_defect");
    expect(entry.severity).toBe("high");
    expect(entry.context?.file).toBe("scripts/testing/reporting/html/styles.ts");
    expect(entry.context?.defectReference).toBe(DEFECT_REF);
  });

  test("18. verifies zero TypeScript any and zero compiler suppressions across write scope", () => {
    const filesToAudit = [
      join(
        process.cwd(),
        "olt/scripts/src/validation/defect-html-reporter-escaped-backtick-unterminated-literal.ts",
      ),
      join(
        process.cwd(),
        "tests/unit/validation/defect-html-reporter-escaped-backtick-unterminated-literal.test.ts",
      ),
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      ["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("|"),
    );

    for (const filePath of filesToAudit) {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;
        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
