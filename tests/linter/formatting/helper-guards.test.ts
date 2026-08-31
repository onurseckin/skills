import { describe, expect, it } from "bun:test";
import {
  ALL_AST_LINT_RULES,
  COMPILER_SUPPRESSION_DIRECTIVES,
  DEFAULT_EXTENSIONS,
  DEFAULT_PROHIBITED_VENDORS,
  extractIdentifierWords,
  isAstLintResult,
  isAstLintViolation,
  isDirectoryLintResult,
  isFixSuggestion,
  type AstLintResult,
  type AstLintViolation,
  type DirectoryLintResult,
  type FixSuggestion,
} from "../../../olt/scripts/src/linter/ast/index.ts";

export const helperGuardsSuiteName = "AST Helper Functions, Type Guards & Constants";

describe(helperGuardsSuiteName, () => {
  it("extracts words from identifiers", () => {
    expect(extractIdentifierWords("openaiClient")).toEqual(["openai", "client"]);
    expect(extractIdentifierWords("AnthropicAPIKey")).toEqual(["anthropic", "api", "key"]);
    expect(extractIdentifierWords("gemini_15_pro")).toEqual(["gemini", "15", "pro"]);
    expect(extractIdentifierWords("")).toEqual([]);
  });

  it("validates isAstLintViolation predicate", () => {
    const validViolation: AstLintViolation = {
      rule: "nullish_coalescing",
      message: "Prohibited ??",
      file: "test.ts",
      line: 1,
      column: 1,
      snippet: "a ?? b",
    };
    expect(isAstLintViolation(validViolation)).toBe(true);
    expect(isAstLintViolation({ invalid: true })).toBe(false);
    expect(isAstLintViolation(null)).toBe(false);
  });

  it("validates isAstLintResult and isDirectoryLintResult predicates", () => {
    const validResult: AstLintResult = {
      valid: true,
      passed: true,
      filePath: "test.ts",
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
    expect(isAstLintResult(validResult)).toBe(true);
    expect(isAstLintResult("string")).toBe(false);

    const validDirResult: DirectoryLintResult = {
      valid: true,
      passed: true,
      directoryPath: "dir",
      totalFiles: 1,
      cleanFiles: 1,
      failedFiles: 0,
      totalViolations: 0,
      fileResults: [validResult],
      summaryByRule: validResult.summaryByRule,
    };
    expect(isDirectoryLintResult(validDirResult)).toBe(true);
    expect(isDirectoryLintResult(null)).toBe(false);
  });

  it("validates isFixSuggestion and isAutoFixResult predicates", () => {
    const validFix: FixSuggestion = {
      rule: "nullish_coalescing",
      file: "app.ts",
      line: 1,
      column: 1,
      originalSnippet: "a ?? b",
      suggestedReplacement: "(a !== undefined && a !== null ? a : b)",
      explanation: "Replace ??",
    };
    expect(isFixSuggestion(validFix)).toBe(true);
    expect(isFixSuggestion({ not: "valid" })).toBe(false);
  });

  it("exports standard constants", () => {
    expect(ALL_AST_LINT_RULES.length).toBe(10);
    expect(DEFAULT_PROHIBITED_VENDORS).toContain("anthropic");
    expect(DEFAULT_PROHIBITED_VENDORS).toContain("openai");
    expect(DEFAULT_PROHIBITED_VENDORS).toContain("gemini");
    expect(DEFAULT_PROHIBITED_VENDORS).toContain("claude");
    expect(DEFAULT_PROHIBITED_VENDORS).toContain("chatgpt");
    expect(DEFAULT_EXTENSIONS).toContain(".ts");
    expect(COMPILER_SUPPRESSION_DIRECTIVES).toContain("@ts-ignore");
  });
});
