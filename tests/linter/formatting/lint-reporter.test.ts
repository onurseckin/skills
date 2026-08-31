import { describe, expect, it } from "bun:test";
import {
  formatAstLintReport,
  formatSummaryTable,
  formatViolationMarkdown,
  type AstLintResult,
  type AstLintViolation,
} from "../../../olt/scripts/src/linter/ast/index.ts";

export const lintReporterSuiteName = "AST Lint Report Formatting & Markdown Table Generation";

describe(lintReporterSuiteName, () => {
  it("formats a single file lint report cleanly for clean file", () => {
    const cleanResult: AstLintResult = {
      valid: true,
      passed: true,
      filePath: "src/clean.ts",
      violations: [],
      totalViolations: 0,
      summaryByRule: {
        nullish_coalescing: 0,
        logical_or_fallback: 0,
        any_type: 0,
        non_null_assertion: 0,
        vendor_leak: 0,
        compiler_suppression: 0,
        mock_tautology: 0,
        trivial_assertion: 0,
        empty_test_body: 0,
        trivial_early_return: 0,
      },
    };

    const report = formatAstLintReport(cleanResult);
    expect(report).toContain("AST LINT FILE REPORT: src/clean.ts");
    expect(report).toContain("Status: PASSED (0 violations)");
    expect(report).toContain("nullish_coalescing: 0");
  });

  it("formats a single file lint report with violations and snippets", () => {
    const violation: AstLintViolation = {
      rule: "nullish_coalescing",
      message: "Prohibited ?? operator",
      file: "src/bad.ts",
      line: 12,
      column: 8,
      snippet: "val ?? defaultVal",
    };

    const badResult: AstLintResult = {
      valid: false,
      passed: false,
      filePath: "src/bad.ts",
      violations: [violation],
      totalViolations: 1,
      summaryByRule: {
        nullish_coalescing: 1,
        logical_or_fallback: 0,
        any_type: 0,
        non_null_assertion: 0,
        vendor_leak: 0,
        compiler_suppression: 0,
        mock_tautology: 0,
        trivial_assertion: 0,
        empty_test_body: 0,
        trivial_early_return: 0,
      },
    };

    const report = formatAstLintReport(badResult);
    expect(report).toContain("AST LINT FILE REPORT: src/bad.ts");
    expect(report).toContain("Status: FAILED (1 violations)");
    expect(report).toContain("Line 12:8 [nullish_coalescing]");
    expect(report).toContain("val ?? defaultVal");
  });

  it("formats violation markdown and summary table", () => {
    const violation: AstLintViolation = {
      rule: "logical_or_fallback",
      message: "Prohibited || operator",
      file: "src/app.ts",
      line: 20,
      column: 4,
      snippet: "name || 'default'",
    };

    const md = formatViolationMarkdown(violation);
    expect(md).toContain("- **[logical_or_fallback]** `src/app.ts:20:4`");
    expect(md).toContain("name || 'default'");

    const table = formatSummaryTable({
      nullish_coalescing: 0,
      logical_or_fallback: 1,
      any_type: 0,
      non_null_assertion: 0,
      vendor_leak: 0,
      compiler_suppression: 0,
      mock_tautology: 0,
      trivial_assertion: 0,
      empty_test_body: 0,
      trivial_early_return: 0,
    });
    expect(table).toContain("| `logical_or_fallback` | 1 |");
  });
});
