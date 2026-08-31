import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isTestIdentifier,
  lintTestAst,
  MOCK_FACTORIES,
  TEST_IDENTIFIERS,
} from "../../../olt/scripts/src/validation/ast-linter/index.ts";

describe("AST Linter & Anti-Mock Verification", () => {
  describe("1. Identifiers and Extraction Helpers", () => {
    it("identifies test identifiers and mock factories", () => {
      expect(isTestIdentifier("test")).toBe(true);
      expect(isTestIdentifier("it")).toBe(true);
      expect(isTestIdentifier("describe")).toBe(false);

      expect(TEST_IDENTIFIERS.has("test")).toBe(true);
      expect(MOCK_FACTORIES.has("fn")).toBe(true);
      expect(MOCK_FACTORIES.has("mockReturnValue")).toBe(true);
    });

    it("extracts test name and finds callback from AST calls", () => {
      const code = `test("my unit test", () => { expect(1).toBe(1); });`;
      const result = lintTestAst(code);
      expect(result.totalTestsAnalyzed).toBe(1);
    });
  });

  describe("2. Empty Test Function Detection", () => {
    it("detects empty test body", () => {
      const code = `
        test("empty test 1", () => {});
        it("empty test 2", function() {});
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.emptyTestCount).toBe(2);
      expect(result.violations.some((v) => v.rule === "empty_test_function")).toBe(true);
    });

    it("passes non-empty tests with valid assertions", () => {
      const code = `
        test("valid test", () => {
          const result = compute(5);
          expect(result).toBe(10);
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(0);
    });
  });

  describe("3. Trivial Early Return Detection", () => {
    it("detects unconditional early return before assertions", () => {
      const code = `
        test("early return test", () => {
          return;
          expect(1).toBe(2);
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.trivialReturnCount).toBe(1);
      expect(result.violations.some((v) => v.rule === "trivial_early_return")).toBe(true);
    });

    it("detects conditional early return before assertions", () => {
      const code = `
        test("conditional return test", () => {
          if (true) return;
          expect(1).toBe(2);
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.trivialReturnCount).toBe(1);
    });
  });

  describe("4. Trivial Constant Assertions Detection", () => {
    it("detects assert(true) and assert.equal literal against itself", () => {
      const code = `
        test("assert true", () => {
          assert(true);
          assert.equal(1, 1);
          assert.isTrue(true);
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.trivialConstantCount).toBeGreaterThanOrEqual(2);
      expect(result.violations.some((v) => v.rule === "trivial_constant_assertion")).toBe(true);
    });

    it("detects expect literal against itself e.g. expect(1).toBe(1)", () => {
      const code = `
        test("tautological expect", () => {
          expect(1).toBe(1);
          expect(true).toEqual(true);
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.trivialConstantCount).toBe(2);
    });

    it("detects variable asserted against itself expect(x).toBe(x)", () => {
      const code = `
        test("variable against itself", () => {
          const x = 5;
          expect(x).toBe(x);
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.trivialConstantCount).toBe(1);
    });
  });

  describe("5. Mock Tautology Detection", () => {
    it("detects mock return value asserted directly without SUT", () => {
      const code = `
        test("mock tautology", () => {
          const myMock = fn().mockReturnValue("stub-value");
          expect(myMock()).toBe("stub-value");
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.mockTautologyCount).toBe(1);
      expect(result.violations.some((v) => v.rule === "mock_tautology")).toBe(true);
    });

    it("detects mock asserted without passing to any SUT", () => {
      const code = `
        test("isolated mock assertion", () => {
          const myMock = mock();
          expect(myMock.called).toBe(true);
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.mockTautologyCount).toBe(1);
    });

    it("detects destructured mock declarations without SUT execution", () => {
      const code = `
        test("destructured mock test", () => {
          const { fn } = vi;
          const myMock = fn();
          expect(myMock).toHaveBeenCalledTimes(0);
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.mockTautologyCount).toBe(1);
    });

    it("detects monkey-patched property mock assertions without SUT execution", () => {
      const code = `
        test("monkey-patched mock test", () => {
          const service = { get: () => 0 };
          service.get = vi.fn().mockReturnValue(42);
          expect(service.get()).toBe(42);
        });
      `;
      const result = lintTestAst(code);
      expect(result.passed).toBe(false);
      expect(result.mockTautologyCount).toBe(1);
    });

    it("recognizes chained test runners and concise arrow function bodies", () => {
      const code = `
        test.concurrent("concurrent concise test", () => expect(1).toBe(1));
        it.skip("skipped block test", () => { return; expect(2).toBe(2); });
      `;
      const result = lintTestAst(code);
      expect(result.totalTestsAnalyzed).toBe(2);
      expect(result.trivialConstantCount).toBe(2);
      expect(result.trivialReturnCount).toBe(1);
    });
  });

  describe("6. Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    it("verifies zero TypeScript any and zero suppressions across ast-linter source and test files", () => {
      const filesToAudit = [
        resolve(import.meta.dir, "../../../olt/scripts/src/validation/ast-linter/types.ts"),
        resolve(
          import.meta.dir,
          "../../../olt/scripts/src/validation/ast-linter/assertion-detectors.ts",
        ),
        resolve(
          import.meta.dir,
          "../../../olt/scripts/src/validation/ast-linter/mock-detectors.ts",
        ),
        resolve(import.meta.dir, "../../../olt/scripts/src/validation/ast-linter/visitor.ts"),
        resolve(import.meta.dir, "../../../olt/scripts/src/validation/ast-linter/index.ts"),
        resolve(import.meta.dir, "ast-linter.test.ts"),
      ];

      const anyPattern = /:\s*any\b|as\s+any\b|<any>/;
      const suppressionPattern = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
        ].join("|"),
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
});
