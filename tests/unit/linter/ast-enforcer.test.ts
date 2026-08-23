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
  extractIdentifierWords,
  formatAstLintReport,
  isAstLintResult,
  isAstLintViolation,
  isDirectoryLintResult,
  lintDirectory,
  lintFile,
  lintSourceCode,
  type AstLintOptions,
  type AstLintResult,
  type AstLintRule,
  type AstLintViolation,
  type DirectoryLintResult,
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
        if (isA) {
          doWork();
        } else if (isB) {
          doWork();
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
      const code = "function handle(data: any): any { return data; }";
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.any_type).toBe(2);
    });

    it("detects 'any' in type arguments and type casts", () => {
      const code = `
        const list: Array<any> = [];
        const casted = val as any;
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.any_type).toBe(2);
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
        import { OpenAI } from "openai";
        import * as Anthropic from "anthropic";
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.vendor_leak).toBeGreaterThanOrEqual(2);
    });

    it("detects vendor names in export declarations and require calls", () => {
      const code = `
        export * from "gemini-sdk";
        const mod = require("chatgpt");
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.vendor_leak).toBeGreaterThanOrEqual(2);
    });

    it("respects custom vendor names supplied in options", () => {
      const code = "const llamaModel = new Llama();";
      const customOptions: AstLintOptions = {
        vendorNames: ["llama", "mistral"],
      };
      const result = lintSourceCode(code, "test.ts", customOptions);

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.vendor_leak).toBe(2);
    });

    it("passes neutral non-vendor identifiers", () => {
      const code = `
        const modelClient = new Client();
        class InferenceEngine {}
        function dispatchInference() {}
        const apiKey = "secret";
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
        const x = 1;
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

    it("detects @ts-nocheck and @ts-expect-error in block comments", () => {
      const code = `
        /* @ts-nocheck */
        const a = 1;
        /* @ts-expect-error */
        const b = a();
      `;
      const result = lintSourceCode(code, "test.ts");

      expect(result.valid).toBe(false);
      expect(result.summaryByRule.compiler_suppression).toBe(2);
    });

    it("does not flag ordinary documentation comments", () => {
      const code = `
        /**
         * Computes the factorial of n.
         * @param n Positive integer.
         * @returns Factorial result.
         */
        function factorial(n: number): number {
          return n <= 1 ? 1 : n * factorial(n - 1);
        }
      `;
      const result = lintSourceCode(code, "clean.ts");

      expect(result.valid).toBe(true);
      expect(result.summaryByRule.compiler_suppression).toBe(0);
    });
  });

  describe("7. Multi-Rule Aggregation & Selective Filtering", () => {
    it("aggregates all 6 rule violations accurately in one source file", () => {
      const dirtyCode = `
        // @ts-ignore
        const openai = (raw: any) => {
          const config = raw ?? {};
          const fallback = config.port || 8080;
          return config.host!;
        };
      `;
      const result = lintSourceCode(dirtyCode, "all-violations.ts");

      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(6);
      expect(result.summaryByRule.compiler_suppression).toBe(1);
      expect(result.summaryByRule.vendor_leak).toBe(1);
      expect(result.summaryByRule.any_type).toBe(1);
      expect(result.summaryByRule.nullish_coalescing).toBe(1);
      expect(result.summaryByRule.logical_or_fallback).toBe(1);
      expect(result.summaryByRule.non_null_assertion).toBe(1);
    });

    it("filters rules via enabledRules option", () => {
      const dirtyCode = `
        const x: any = a ?? b;
      `;
      const options: AstLintOptions = {
        enabledRules: ["any_type"],
      };
      const result = lintSourceCode(dirtyCode, "test.ts", options);

      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(1);
      expect(result.summaryByRule.any_type).toBe(1);
      expect(result.summaryByRule.nullish_coalescing).toBe(0);
    });

    it("skips rules via disabledRules option", () => {
      const dirtyCode = `
        const x: any = a ?? b;
      `;
      const options: AstLintOptions = {
        disabledRules: ["any_type"],
      };
      const result = lintSourceCode(dirtyCode, "test.ts", options);

      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(1);
      expect(result.summaryByRule.any_type).toBe(0);
      expect(result.summaryByRule.nullish_coalescing).toBe(1);
    });
  });

  describe("8. File and Directory Operations", () => {
    const testTempDir = join(tmpdir(), "ast-linter-unit-tests-" + String(Date.now()));

    it("lints a single file on disk", () => {
      mkdirSync(testTempDir, { recursive: true });
      const testFile = join(testTempDir, "sample.ts");
      writeFileSync(testFile, "const cleanVar: string = 'hello';", "utf-8");

      const result = lintFile(testFile);
      expect(result.valid).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.filePath).toBe(testFile);

      rmSync(testFile, { force: true });
    });

    it("throws HarnessError PATH_SAFETY if file does not exist", () => {
      expect(() => lintFile("/non/existent/path/for/sure/file.ts")).toThrow();
      try {
        lintFile("/non/existent/path/for/sure/file.ts");
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        if (err instanceof HarnessError) {
          expect(err.code).toBe("PATH_SAFETY");
        }
      }
    });

    it("lints an entire directory tree recursively", () => {
      mkdirSync(join(testTempDir, "sub"), { recursive: true });
      writeFileSync(
        join(testTempDir, "clean.ts"),
        "export const cleanValue = 42;",
        "utf-8",
      );
      writeFileSync(
        join(testTempDir, "sub", "dirty.ts"),
        "export const bad = a ?? b;",
        "utf-8",
      );
      writeFileSync(
        join(testTempDir, "sub", "ignored.txt"),
        "some non-code content ?? || any",
        "utf-8",
      );

      const dirResult = lintDirectory(testTempDir);
      expect(dirResult.valid).toBe(false);
      expect(dirResult.totalFiles).toBe(2);
      expect(dirResult.cleanFiles).toBe(1);
      expect(dirResult.failedFiles).toBe(1);
      expect(dirResult.totalViolations).toBe(1);
      expect(dirResult.summaryByRule.nullish_coalescing).toBe(1);

      rmSync(testTempDir, { recursive: true, force: true });
    });

    it("throws HarnessError PATH_SAFETY if directory does not exist or is not a directory", () => {
      expect(() => lintDirectory("/non/existent/path/dir")).toThrow();
    });
  });

  describe("9. Report Formatting (formatAstLintReport)", () => {
    it("formats a single file lint report cleanly for clean file", () => {
      const cleanResult = lintSourceCode("const x: number = 1;", "clean.ts");
      const report = formatAstLintReport(cleanResult);

      expect(report).toContain("AST LINT FILE REPORT: clean.ts");
      expect(report).toContain("Status: PASSED (0 violations)");
      expect(report).toContain("- nullish_coalescing: 0");
    });

    it("formats a single file lint report with violations and snippets", () => {
      const dirtyResult = lintSourceCode("const x = a ?? b;", "dirty.ts");
      const report = formatAstLintReport(dirtyResult);

      expect(report).toContain("AST LINT FILE REPORT: dirty.ts");
      expect(report).toContain("Status: FAILED (1 violations)");
      expect(report).toContain("Line 1:");
      expect(report).toContain("[nullish_coalescing]");
      expect(report).toContain("a ?? b");
    });

    it("formats a directory lint report", () => {
      const fileRes1: AstLintResult = {
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
        },
      };

      const fileRes2: AstLintResult = {
        valid: false,
        passed: false,
        filePath: "src/bad.ts",
        violations: [
          {
            rule: "any_type",
            message: "Prohibited 'any' type annotation detected.",
            file: "src/bad.ts",
            line: 10,
            column: 5,
            snippet: "let x: any;",
          },
        ],
        totalViolations: 1,
        summaryByRule: {
          nullish_coalescing: 0,
          logical_or_fallback: 0,
          any_type: 1,
          non_null_assertion: 0,
          vendor_leak: 0,
          compiler_suppression: 0,
        },
      };

      const dirResult: DirectoryLintResult = {
        valid: false,
        passed: false,
        directoryPath: "src",
        totalFiles: 2,
        cleanFiles: 1,
        failedFiles: 1,
        totalViolations: 1,
        fileResults: [fileRes1, fileRes2],
        summaryByRule: {
          nullish_coalescing: 0,
          logical_or_fallback: 0,
          any_type: 1,
          non_null_assertion: 0,
          vendor_leak: 0,
          compiler_suppression: 0,
        },
      };

      const report = formatAstLintReport(dirResult);
      expect(report).toContain("AST LINT DIRECTORY REPORT: src");
      expect(report).toContain("Files scanned: 2 (Clean: 1, Failed: 1)");
      expect(report).toContain("File: src/bad.ts (1 violations)");
      expect(report).toContain("Line 10:5 [any_type]");
    });
  });

  describe("10. assertZeroFallbackCompliance Assertion Guard", () => {
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

  describe("11. Self-Compliance Invariant Verification", () => {
    it("ast-enforcer.ts itself is 100% compliant with zero fallback and no violations", () => {
      const linterPath = "orchestrating-long-tasks/scripts/src/linter/ast-enforcer.ts";
      const result = lintFile(linterPath);

      expect(result.valid).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.violations).toEqual([]);
    });
  });

  describe("12. Helper Functions & Type Guards", () => {
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

    it("exports standard constants", () => {
      expect(ALL_AST_LINT_RULES.length).toBe(6);
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
