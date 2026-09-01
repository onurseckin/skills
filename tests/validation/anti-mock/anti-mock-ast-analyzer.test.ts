import { describe, expect, test } from "bun:test";
import {
  AntiMockEngine,
  checkAssertionFloor,
  evaluateAntiMock,
  formatAntiMockReport,
  generateMutants,
  lintTestAst,
  runMutationGate,
} from "../../../olt/scripts/src/validation/index.ts";
import type {
  AntiMockDiagnosticReport,
  AntiMockEvaluationInput,
  MutantRecord,
  MutationTestRunOutcome,
} from "../../../olt/scripts/src/validation/anti-mock/index.ts";

describe("Pillar 1: AST Early-Return & Mock Tautology Linter", () => {
  test("detects empty test functions (arrow and function expressions)", () => {
    const code = `
      test("empty arrow test", () => {});
      it("empty function test", function() {});
      test.only("empty with whitespace", () => {
        
      });
      test("concise empty", () => undefined);
      test(() => {});
      test("no callback");
    `;
    const result = lintTestAst(code, { file: "test.ts" });
    expect(result.passed).toBe(false);
    expect(result.emptyTestCount).toBe(4);
    expect(result.violations[0]?.rule).toBe("empty_test_function");
    expect(result.violations[0]?.testName).toBe("empty arrow test");
    expect(result.violations[1]?.testName).toBe("empty function test");
    expect(result.violations[2]?.testName).toBe("empty with whitespace");
    expect(result.violations[3]?.testName).toBe("<anonymous test>");
  });

  test("detects trivial early returns before assertions", () => {
    const code = `
      test("early return test", () => {
        return;
        expect(1 + 1).toBe(2);
      });
      it("conditional early return before any assertion", () => {
        if (true) {
          return;
        }
        expect(2 + 2).toBe(4);
      });
      test("single line if return", () => {
        if (false) return;
        expect(3 + 3).toBe(6);
      });
    `;
    const result = lintTestAst(code);
    expect(result.passed).toBe(false);
    expect(result.trivialReturnCount).toBe(3);
    expect(result.violations.some((v) => v.rule === "trivial_early_return")).toBe(true);
  });

  test("allows valid returns after assertions have run", () => {
    const code = `
      test("valid return after assert", () => {
        const val = calculate();
        expect(val).toBe(42);
        if (val === 42) return;
        expect(val).toBeGreaterThan(0);
      });
      test("if block with assertions inside and after", () => {
        if (true) {
          expect(1).toBeGreaterThan(0);
        }
        expect(2).toBe(2);
      });
    `;
    const result = lintTestAst(code);
    expect(result.trivialReturnCount).toBe(0);
  });

  test("detects trivial constant assertions on literals and primitives", () => {
    const code = `
      test("tautological constant test", () => {
        expect(true).toBe(true);
        expect(1).toEqual(1);
        expect("abc").toStrictEqual("abc");
        expect(true).toBeTruthy();
        expect(false).toBeFalsy();
        expect(null).toBeNull();
        expect(undefined).toBeUndefined();
        expect(NaN).toBeNaN();
        expect([]).toBeDefined();
        expect(-5).toBe(-5);
        assert(true);
        assert.isTrue(true);
        assert.isFalse(false);
        assert.equal(1, 1);
        assert.strictEqual("foo", "foo");
        assert.deepEqual([], []);
      });
      test("non-tautological assert", () => {
        assert.equal(1, 2);
        assert.isTrue(isValidCondition());
      });
    `;
    const result = lintTestAst(code);
    expect(result.passed).toBe(false);
    expect(result.trivialConstantCount).toBeGreaterThanOrEqual(15);
    expect(result.violations.every((v) => v.rule === "trivial_constant_assertion")).toBe(true);
  });

  test("detects variable identity tautology assertions (expect(x).toBe(x))", () => {
    const code = `
      test("identity tautology", () => {
        const x = calculateResult();
        expect(x).toBe(x);
      });
    `;
    const result = lintTestAst(code);
    expect(result.passed).toBe(false);
    expect(result.trivialConstantCount).toBe(1);
    expect(result.violations[0]?.rule).toBe("trivial_constant_assertion");
    expect(result.violations[0]?.message).toContain("asserts variable 'x' against itself");
  });

  test("detects mock tautologies where stubbed return values are asserted directly", () => {
    const code = `
      test("stubbed return value tautology", () => {
        const mockFn = vi.fn().mockReturnValue(42);
        expect(mockFn()).toBe(42);
      });
    `;
    const result = lintTestAst(code);
    expect(result.passed).toBe(false);
    expect(result.mockTautologyCount).toBe(1);
    expect(result.violations[0]?.rule).toBe("mock_tautology");
    expect(result.violations[0]?.message).toContain("asserts stubbed mock 'mockFn()' return value");
  });

  test("detects mock tautologies where mock is created and asserted without SUT exercise", () => {
    const code = `
      test("unexercised mock tautology", () => {
        const mockCallback = vi.fn();
        mockCallback();
        expect(mockCallback).toHaveBeenCalled();
      });
      test("mock object without SUT", () => {
        const mockService = { doAction: vi.fn() };
        expect(mockService.doAction).toBeDefined();
      });
    `;
    const result = lintTestAst(code);
    expect(result.passed).toBe(false);
    expect(result.mockTautologyCount).toBe(2);
  });

  test("passes valid tests exercising mocks passed into real SUT functions", () => {
    const code = `
      test("valid SUT test", () => {
        const mockLogger = vi.fn();
        const service = new UserService(mockLogger);
        service.createUser("Alice");
        expect(mockLogger).toHaveBeenCalled();
        expect(service.getUserCount()).toBe(1);
      });
      test("valid function with mock param", () => {
        const mockFn = vi.fn();
        processItems([1, 2, 3], mockFn);
        expect(mockFn).toHaveBeenCalledTimes(3);
      });
      test("non-mock object initialization", () => {
        const config = { active: true };
        expect(config.active).toBe(true);
      });
    `;
    const result = lintTestAst(code);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.totalTestsAnalyzed).toBe(3);
  });

  test("respects linter options disabling specific rules", () => {
    const code = `
      test("empty test", () => {});
      test("tautology", () => { expect(1).toBe(1); });
    `;
    const result = lintTestAst(code, {
      detectEmptyTests: false,
      detectTrivialConstants: false,
    });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("handles describe.test, it.concurrent, and test.each syntax with template names", () => {
    const code = `
      describe.test("describe test", () => {
        expect(compute(2)).toBe(4);
      });
      test.each([1, 2])(\`each test with \${1}\`, (n) => {
        expect(n).toBeGreaterThan(0);
      });
      it.concurrent("concurrent test", () => {
        expect(asyncTask()).toBeDefined();
      });
      describe("suite", () => {
        it.only("nested only", () => {
          expect(1 + 1).toBe(2);
        });
      });
    `;
    const result = lintTestAst(code, { file: "test.tsx" });
    expect(result.passed).toBe(true);
    expect(result.totalTestsAnalyzed).toBe(4);
  });

  test("handles mock factories and helper chains (mockResolvedValue, mockImplementation, spyOn)", () => {
    const code = `
      test("mock helpers", () => {
        const fn1 = jest.fn().mockResolvedValue("async_val");
        const fn2 = vi.spyOn(service, "method");
        const fn3 = mock(() => "direct_mock");
        const fn4 = vi.fn().mockImplementation(() => 100);
        expect(fn1()).toBe("async_val");
      });
    `;
    const result = lintTestAst(code);
    expect(result.passed).toBe(false);
    expect(result.mockTautologyCount).toBeGreaterThan(0);
  });
});
