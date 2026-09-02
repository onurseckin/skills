import { describe, expect, it } from "bun:test";
import ts from "typescript";
import type { AstLintViolation, RuleContext } from "../../../olt/scripts/src/linter/ast/index.ts";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/index.ts";
import { mockTautologyRule } from "../../../olt/scripts/src/linter/rules/testing/mock_tautology.ts";

describe("mockTautologyRule Comprehensive Coverage", () => {
  it("exposes rule metadata and fix suggestion generator", () => {
    expect(mockTautologyRule.rule).toBe("mock_tautology");
    const suggestion = mockTautologyRule.generateFixSuggestion?.();
    expect(suggestion).toBeDefined();
    expect(suggestion?.suggestedReplacement).toContain("Pass mock to system under test");
    expect(suggestion?.explanation).toContain("Avoid asserting on mocks directly");
  });

  it("detects stubbed mock return value asserted directly against expected literal", () => {
    const code = `
      test("stubbed return test", () => {
        const mockFetcher = fn().mockReturnValue("expected-data");
        expect(mockFetcher()).toBe("expected-data");
      });
    `;
    const result = lintSourceCode(code, "test-file.ts");
    expect(result.valid).toBe(false);
    expect(result.summaryByRule.mock_tautology).toBe(1);

    const violation = result.violations[0];
    expect(violation !== undefined).toBe(true);
    if (violation !== undefined) {
      expect(violation.rule).toBe("mock_tautology");
      expect(violation.message).toContain("asserts stubbed mock 'mockFetcher()'");
      expect(violation.message).toContain("expected-data");
      expect(violation.testName).toBe("stubbed return test");
    }
  });

  it("detects mock assertions when mock is never passed to system under test", () => {
    const code = `
      it("unpassed mock assertion", () => {
        const mockHandler = jest.fn();
        expect(mockHandler).toHaveBeenCalled();
      });
    `;
    const result = lintSourceCode(code, "test-file.ts");
    expect(result.valid).toBe(false);
    expect(result.summaryByRule.mock_tautology).toBe(1);

    const violation = result.violations[0];
    expect(violation !== undefined).toBe(true);
    if (violation !== undefined) {
      expect(violation.rule).toBe("mock_tautology");
      expect(violation.message).toContain("without passing it to any implementation under test");
    }
  });

  it("permits mock assertions when mock is passed as argument to a function", () => {
    const code = `
      test("mock passed into function", () => {
        const mockCallback = jest.fn();
        executeTask(mockCallback);
        expect(mockCallback).toHaveBeenCalled();
      });
    `;
    const result = lintSourceCode(code, "test-file.ts");
    expect(result.summaryByRule.mock_tautology ?? 0).toBe(0);
  });

  it("permits mock assertions when mock is passed into a class constructor", () => {
    const code = `
      test("mock passed into new expression", () => {
        const mockDep = vi.fn();
        const service = new TaskService(mockDep);
        expect(mockDep).toHaveBeenCalledTimes(1);
      });
    `;
    const result = lintSourceCode(code, "test-file.ts");
    expect(result.summaryByRule.mock_tautology ?? 0).toBe(0);
  });

  it("permits assertions when mixed with assertions on real system outputs", () => {
    const code = `
      test("mixed mock and production output assertions", () => {
        const mockDb = jest.fn();
        const result = computeTotal(10, 20);
        expect(mockDb).toBeDefined();
        expect(result).toBe(30);
      });
    `;
    const result = lintSourceCode(code, "test-file.ts");
    expect(result.summaryByRule.mock_tautology ?? 0).toBe(0);
  });

  it("flags direct method invocations on mock objects as tautologies when not passed to SUT", () => {
    const code = `
      test("direct method call on mock", () => {
        const mockObj = { execute: jest.fn() };
        mockObj.execute();
        expect(mockObj.execute).toHaveBeenCalled();
      });
    `;
    const result = lintSourceCode(code, "test-file.ts");
    expect(result.valid).toBe(false);
    expect(result.summaryByRule.mock_tautology).toBe(1);
  });

  it("ignores non-test call expressions and tests with zero mocks", () => {
    const code = `
      console.log("hello world");
      helperFunction();

      test("pure computation test without mocks", () => {
        const sum = 1 + 2;
        expect(sum).toBe(3);
      });
    `;
    const result = lintSourceCode(code, "test-file.ts");
    expect(result.summaryByRule.mock_tautology ?? 0).toBe(0);
  });

  it("safely checks AST nodes directly with checkNode", () => {
    const sourceText = 'const x = 10; function run() { console.log("hi"); }';
    const sourceFile = ts.createSourceFile("inline.ts", sourceText, ts.ScriptTarget.Latest, true);
    const violations: AstLintViolation[] = [];
    const context: RuleContext = {
      sourceFile,
      fileName: "inline.ts",
      options: { enabledRules: ["mock_tautology"] },
      violations,
    };

    ts.forEachChild(sourceFile, (node) => {
      mockTautologyRule.checkNode(node, context);
    });

    expect(violations.length).toBe(0);
  });
});
