import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  ALL_AST_LINT_RULES,
  COMPILER_SUPPRESSION_DIRECTIVES,
  DEFAULT_EXTENSIONS,
  DEFAULT_PROHIBITED_VENDORS,
  assertZeroFallbackCompliance,
  autoFixSourceCode,
  extractIdentifierWords,
  formatAstLintReport,
  formatSummaryTable,
  formatViolationMarkdown,
  generateFixSuggestion,
  isAstLintResult,
  isAstLintViolation,
  isAutoFixResult,
  isDirectoryLintResult,
  isFixSuggestion,
  lintDirectory,
  lintFile,
  lintSourceCode,
  suggestRefactorings,
  type AstLintOptions,
  type AstLintResult,
  type AstLintViolation,
  type DirectoryLintResult,
  type FixSuggestion,
} from "../../../orchestrating-long-tasks/scripts/src/linter/ast-enforcer.ts";

describe("Structural Zero-Fallback AST Linter & Vendor Identifier Enforcer", () => {
  describe("1. Nullish Coalescing (??) Rule", () => {
    it("detects nullish coalescing operator in variable assignments", () => {
      const code = "const value = input ?? 'default_val';";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.passed).toBe(false);
      expect(result.totalViolations).toBe(1);
      expect(result.summaryByRule.nullish_coalescing).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("nullish_coalescing");
        expect(violation.line).toBe(1);
        expect(violation.message).toContain("Prohibited nullish coalescing operator (??)");
        expect(violation.snippet).toContain("input ?? 'default_val'");
      }
    });

    it("detects chained nullish coalescing expressions", () => {
      const code = "const res = a ?? b ?? c;";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.nullish_coalescing).toBe(2);
    });

    it("passes clean explicit branching code without nullish coalescing", () => {
      const code = `
        let value = 'default_val';
        if (input !== undefined && input !== null) {
          value = input;
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.summaryByRule.nullish_coalescing).toBe(0);
    });
  });

  describe("2. Logical OR (||) Rule", () => {
    it("detects logical OR fallback assignments", () => {
      const code = "const name = userName || 'guest';";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(1);
      expect(result.summaryByRule.logical_or_fallback).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("logical_or_fallback");
        expect(violation.message).toContain("Prohibited logical OR operator (||)");
      }
    });

    it("detects logical OR in conditionals", () => {
      const code = `
        if (isA || isB) {
          doWork();
        }
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.logical_or_fallback).toBe(1);
    });

    it("passes clean explicit if-else without logical OR", () => {
      const code = `
        let active = false;
        if (isA) {
          active = true;
        } else if (isB) {
          active = true;
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.summaryByRule.logical_or_fallback).toBe(0);
    });
  });

  describe("3. Any Type Annotation Rule", () => {
    it("detects 'any' type in variable declarations", () => {
      const code = "const payload: any = JSON.parse(raw);";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.any_type).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("any_type");
        expect(violation.message).toContain("Prohibited 'any' type annotation");
      }
    });

    it("detects 'any' type in function parameter and return type", () => {
      const code = "function process(item: any): any { return item; }";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.any_type).toBe(2);
    });

    it("detects 'any' in type arguments and type casts", () => {
      const code = `
        const map = new Map<string, any>();
        const obj = (data as any).property;
        const cast = <any>value;
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.any_type).toBe(3);
    });

    it("passes clean strictly-typed code with unknown and type guards", () => {
      const code = `
        function handle(data: unknown): string {
          if (typeof data === "string") {
            return data;
          }
          return "";
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.summaryByRule.any_type).toBe(0);
    });
  });

  describe("4. Non-Null Assertion (!) Rule", () => {
    it("detects non-null assertion on property access", () => {
      const code = "const name = user!.profile.name;";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.non_null_assertion).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("non_null_assertion");
        expect(violation.message).toContain("Prohibited non-null assertion operator (!)");
      }
    });

    it("detects non-null assertion on map.get calls and array lookups", () => {
      const code = `
        const item = map.get("key")!;
        const first = list![0];
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.non_null_assertion).toBe(2);
    });

    it("passes clean explicit undefined check instead of non-null assertion", () => {
      const code = `
        const item = map.get("key");
        if (item !== undefined && item !== null) {
          useItem(item);
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.summaryByRule.non_null_assertion).toBe(0);
    });
  });

  describe("5. Vendor Identifier Leak Rule", () => {
    it("detects prohibited vendor identifiers across camelCase, PascalCase, snake_case", () => {
      const code = `
        const anthropicClient = new Client();
        class OpenAiService {}
        function call_gemini_api() {}
        const claude_key = "secret";
        const chatgptResponse = {};
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.vendor_leak).toBe(5);
    });

    it("detects vendor names in import statements and module specifiers", () => {
      const code = `
        import { Anthropic } from "@anthropic-ai/sdk";
        import OpenAI from "openai";
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.vendor_leak).toBeGreaterThanOrEqual(2);
    });

    it("detects vendor names in export declarations and require calls", () => {
      const code = `
        export { geminiClient } from "./gemini";
        const openai = require("openai");
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.vendor_leak).toBeGreaterThanOrEqual(2);
    });

    it("respects custom vendor names supplied in options", () => {
      const code = `
        const customVendorApi = create();
        const regularService = standard();
      `;
      const options: AstLintOptions = {
        vendorNames: ["customvendor"],
      };
      const result = lintSourceCode(code, "test.ts", options);

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.vendor_leak).toBe(1);
    });

    it("passes neutral non-vendor identifiers", () => {
      const code = `
        const harness = new TestHarness();
        const coordinator = new Coordinator();
        const telemetry = collectMetrics();
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.summaryByRule.vendor_leak).toBe(0);
    });
  });

  describe("6. Compiler Suppression Directive Rule", () => {
    it("detects @ts-ignore in single-line comments", () => {
      const code = `
        // @ts-ignore
        const value = badCall();
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.compiler_suppression).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("compiler_suppression");
        expect(violation.message).toContain("@ts-ignore");
      }
    });

    it("detects @ts-nocheck, @ts-expect-error, and eslint-disable in comments", () => {
      const code = `
        /* @ts-nocheck */
        // @ts-expect-error: expected type mismatch
        // eslint-disable-next-line
        const x = 1;
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.compiler_suppression).toBe(3);
    });

    it("does not flag ordinary documentation comments", () => {
      const code = `
        /**
         * Normal method documentation.
         * Explains function behavior clearly.
         */
        export function computeScore(input: number): number {
          return input * 2;
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.summaryByRule.compiler_suppression).toBe(0);
    });
  });

  describe("7. Test Anti-Pattern Rules (mock_tautology, trivial_assertion, empty_test_body, trivial_early_return)", () => {
    it("detects empty test function bodies", () => {
      const code = `
        test("empty test body", () => {});
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.empty_test_body).toBe(1);

      const violation = result.violations[0];
      expect(violation !== undefined).toBe(true);
      if (violation !== undefined) {
        expect(violation.rule).toBe("empty_test_body");
        expect(violation.message).toContain("empty function body");
      }
    });

    it("detects trivial early return before assertions", () => {
      const code = `
        test("early return test", () => {
          return;
          expect(1).toBe(2);
        });
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.trivial_early_return).toBe(1);
    });

    it("detects mock return tautology asserted directly against stub without SUT", () => {
      const code = `
        test("mock tautology", () => {
          const mockFn = fn().mockReturnValue("stubbed");
          expect(mockFn()).toBe("stubbed");
        });
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.mock_tautology).toBe(1);
    });

    it("detects trivial constant assertions comparing literal against itself", () => {
      const code = `
        test("trivial literal", () => {
          expect(1).toBe(1);
          assert(true);
        });
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.trivial_assertion).toBe(2);
    });

    it("detects variable asserted against itself in expect(x).toBe(x)", () => {
      const code = `
        test("identity tautology", () => {
          const x = 42;
          expect(x).toBe(x);
        });
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.trivial_assertion).toBe(1);
    });
  });

  describe("8. Multi-Rule Aggregation & Selective Filtering", () => {
    it("aggregates all rule violations accurately in one source file", () => {
      const code = `
        // @ts-ignore
        const openaiService: any = client ?? backupClient;
        const val = list!.item || "fallback";
      `;
      const result = lintSourceCode(code, "bad.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.compiler_suppression).toBe(1);
      expect(result.summaryByRule.vendor_leak).toBeGreaterThanOrEqual(1);
      expect(result.summaryByRule.any_type).toBe(1);
      expect(result.summaryByRule.nullish_coalescing).toBe(1);
      expect(result.summaryByRule.non_null_assertion).toBe(1);
      expect(result.summaryByRule.logical_or_fallback).toBe(1);
    });

    it("filters rules via enabledRules option", () => {
      const code = `
        const x: any = 1;
        const y = a ?? b;
      `;
      const options: AstLintOptions = {
        enabledRules: ["nullish_coalescing"],
      };
      const result = lintSourceCode(code, "test.ts", options);

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.nullish_coalescing).toBe(1);
      expect(result.summaryByRule.any_type).toBe(0);
    });

    it("skips rules via disabledRules option", () => {
      const code = `
        const x: any = 1;
        const y = a ?? b;
      `;
      const options: AstLintOptions = {
        disabledRules: ["any_type"],
      };
      const result = lintSourceCode(code, "test.ts", options);

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.any_type).toBe(0);
      expect(result.summaryByRule.nullish_coalescing).toBe(1);
    });
  });

  describe("9. File and Directory Operations", () => {
    const testDir = join(
      tmpdir(),
      `ast-linter-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );

    it("lints a single file on disk", () => {
      mkdirSync(testDir, { recursive: true });
      const testFile = join(testDir, "sample.ts");
      writeFileSync(testFile, "export const x = a ?? b;", "utf-8");

      const result = lintFile(testFile);
      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(1);
      expect(result.filePath).toBe(testFile);

      rmSync(testDir, { recursive: true, force: true });
    });

    it("throws HarnessError PATH_SAFETY if file does not exist", () => {
      const nonExistent = join(tmpdir(), "non_existent_file.ts");
      expect(() => lintFile(nonExistent)).toThrow();

      try {
        lintFile(nonExistent);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        if (err instanceof HarnessError) {
          expect(err.code).toBe("PATH_SAFETY");
        }
      }
    });

    it("lints an entire directory tree recursively", () => {
      mkdirSync(join(testDir, "sub"), { recursive: true });
      writeFileSync(join(testDir, "clean.ts"), "export const a: number = 1;", "utf-8");
      writeFileSync(join(testDir, "sub", "bad.ts"), "export const b: any = 2;", "utf-8");

      const dirResult = lintDirectory(testDir);
      expect(dirResult.valid).toBe(false);
      expect(dirResult.totalFiles).toBe(2);
      expect(dirResult.cleanFiles).toBe(1);
      expect(dirResult.failedFiles).toBe(1);
      expect(dirResult.totalViolations).toBe(1);
      expect(dirResult.summaryByRule.any_type).toBe(1);

      rmSync(testDir, { recursive: true, force: true });
    });

    it("throws HarnessError PATH_SAFETY if directory does not exist or is not a directory", () => {
      const nonExistent = join(tmpdir(), "no_such_directory_123");
      expect(() => lintDirectory(nonExistent)).toThrow();

      try {
        lintDirectory(nonExistent);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        if (err instanceof HarnessError) {
          expect(err.code).toBe("PATH_SAFETY");
        }
      }
    });
  });

  describe("10. Auto-Fix & Refactoring Suggestions", () => {
    it("generates refactoring suggestions for violations", () => {
      const violation: AstLintViolation = {
        rule: "nullish_coalescing",
        message: "Prohibited ??",
        file: "test.ts",
        line: 5,
        column: 10,
        snippet: "val ?? 'default'",
      };

      const suggestion = generateFixSuggestion(violation);
      expect(suggestion.rule).toBe("nullish_coalescing");
      expect(suggestion.suggestedReplacement).toContain("!==");
      expect(suggestion.explanation).toContain("explicit nullish checks");
    });

    it("suggests refactorings for complete lint results", () => {
      const code = `
        const x: any = 1;
        const y = a ?? b;
      `;
      const result = lintSourceCode(code, "test.ts");
      const suggestions = suggestRefactorings(result, code);

      expect(suggestions.length).toBe(2);
      expect(suggestions[0] !== undefined).toBe(true);
      expect(suggestions[1] !== undefined).toBe(true);
    });

    it("auto-fixes source code transforming ?? and as any", () => {
      const badCode = `
        // @ts-ignore
        const val = input ?? fallback;
        const obj = data as any;
      `;
      const autoFixResult = autoFixSourceCode(badCode, "test.ts");

      expect(isAutoFixResult(autoFixResult)).toBe(true);
      expect(autoFixResult.appliedFixesCount).toBeGreaterThan(0);
      expect(autoFixResult.fixedCode).not.toContain("@ts-ignore");
      expect(autoFixResult.fixedCode).not.toContain("as any");
      expect(autoFixResult.fixedCode).toContain("as unknown");
    });
  });

  describe("11. Report Formatting & Table Utilities", () => {
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

  describe("12. assertZeroFallbackCompliance Assertion Guard", () => {
    it("does not throw on fully compliant source code", () => {
      const cleanCode = `
        export function safeGet(map: Map<string, number>, key: string): number {
          const val = map.get(key);
          if (val !== undefined && val !== null) {
            return val;
          }
          return 0;
        }
      `;
      expect(() => assertZeroFallbackCompliance(cleanCode)).not.toThrow();
    });

    it("throws HarnessError INTEGRITY on non-compliant code", () => {
      const badCode = "export const x = a || 10;";
      expect(() => assertZeroFallbackCompliance(badCode)).toThrow();

      try {
        assertZeroFallbackCompliance(badCode);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        if (err instanceof HarnessError) {
          expect(err.code).toBe("INTEGRITY");
          expect(err.message).toContain("Zero-fallback compliance check failed");
        }
      }
    });
  });

  describe("13. Self-Compliance Invariant Verification", () => {
    it("ast-enforcer.ts itself is 100% compliant with zero fallback and no violations", () => {
      const linterPath = "orchestrating-long-tasks/scripts/src/linter/ast-enforcer.ts";
      const result = lintFile(linterPath);

      expect(result.valid).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.violations).toEqual([]);
    });
  });

  describe("14. Helper Functions & Type Guards", () => {
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
});
