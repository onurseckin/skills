import { describe, expect, test } from "bun:test";
import {
  AntiMockEngine,
  checkAssertionFloor,
  evaluateAntiMock,
  formatAntiMockReport,
  generateMutants,
  lintTestAst,
  runMutationGate,
} from "../../../orchestrating-long-tasks/scripts/src/validation/index.ts";
import type {
  AntiMockDiagnosticReport,
  AntiMockEvaluationInput,
  MutantRecord,
  MutationTestRunOutcome,
} from "../../../orchestrating-long-tasks/scripts/src/validation/anti-mock-types.ts";

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

describe("Pillar 2: Assertion Count Floor Enforcer", () => {
  test("flags tests containing zero assertions", () => {
    const code = `
      test("zero assertions test", () => {
        const x = 10;
        const y = x * 2;
      });
      it("another zero assertion test", () => {
        console.log("running");
      });
      test(() => {
        const z = 20;
      });
      test("no body");
    `;
    const result = checkAssertionFloor(code, { minAssertionsPerTest: 1 });
    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(3);
    expect(result.totalAssertions).toBe(0);
    expect(result.violations).toHaveLength(4);
    expect(result.violations[0]?.rule).toBe("zero_assertions");
    expect(result.violations[0]?.actualCount).toBe(0);
  });

  test("flags tests with sub-floor assertions when minAssertionsPerTest > 1", () => {
    const code = `
      test("single assert test", () => {
        expect(1 + 1).toBe(2);
      });
      test("two assert test", () => {
        expect(2 * 2).toBe(4);
        expect(3 * 3).toBe(9);
      });
    `;
    const result = checkAssertionFloor(code, { minAssertionsPerTest: 2, minAssertionsPerFile: 3 });
    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(2);
    expect(result.totalAssertions).toBe(3);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.rule).toBe("sub_floor_assertions");
    expect(result.violations[0]?.testName).toBe("single assert test");
    expect(result.violations[0]?.actualCount).toBe(1);
    expect(result.violations[0]?.expectedMin).toBe(2);
  });

  test("flags files below the minimum file-level assertion floor", () => {
    const code = `
      test("valid test 1", () => {
        expect(1).toBe(1);
      });
      test("valid test 2", () => {
        expect(2).toBe(2);
      });
    `;
    const result = checkAssertionFloor(code, { minAssertionsPerTest: 1, minAssertionsPerFile: 5 });
    expect(result.passed).toBe(false);
    expect(result.totalAssertions).toBe(2);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.rule).toBe("sub_floor_file_assertions");
    expect(result.violations[0]?.actualCount).toBe(2);
    expect(result.violations[0]?.expectedMin).toBe(5);
  });

  test("accurately counts assertions across various assertion styles and libraries", () => {
    const code = `
      test("mixed assertions test", () => {
        expect(a).toBe(b);
        assert(isReady);
        assert.strictEqual(foo, bar);
        assert.deepEqual(objA, objB);
        t.is(actual, expected);
        t.assert(condition);
        verify(customCheck);
      });
      describe.it("describe it test", () => {
        expect(1).toBe(1);
      });
      test.each([1])("each test", () => {
        expect(1).toBe(1);
      });
    `;
    const result = checkAssertionFloor(code, {
      minAssertionsPerTest: 1,
      customAssertionIdentifiers: ["verify"],
    });
    expect(result.passed).toBe(true);
    expect(result.totalAssertions).toBe(9);
  });

  test("handles empty source file and template names in JSX/TSX gracefully", () => {
    const code = `// Empty test file`;
    const result = checkAssertionFloor(code, { minAssertionsPerFile: 1 });
    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(0);
    expect(result.totalAssertions).toBe(0);
    expect(result.averageAssertionsPerTest).toBe(0);
    expect(result.violations[0]?.rule).toBe("sub_floor_file_assertions");

    const tsxCode = `
      test(\`template name \${1}\`, () => {
        expect(render(<Button />)).toBeDefined();
      });
    `;
    const tsxResult = checkAssertionFloor(tsxCode, { file: "Button.test.tsx" });
    expect(tsxResult.passed).toBe(true);
    expect(tsxResult.totalAssertions).toBe(1);
  });
});

describe("Pillar 3: Mutation Gate Engine", () => {
  test("generates mutations across boolean, arithmetic, return, comparison, and function body types", () => {
    const code = `
      export function calculateDiscount(price: number, isVip: boolean): number {
        if (price > 100 && isVip === true) {
          return price * 0.8;
        }
        if (!isVip) {
          return price;
        }
        return price - 10;
      }
      export function getGreeting(name: string): string {
        return "Hello " + name;
      }
    `;

    const mutants = generateMutants(code);
    expect(mutants.length).toBeGreaterThan(5);

    const mutationTypes = new Set(mutants.map((m) => m.mutationType));
    expect(mutationTypes.has("invert_boolean")).toBe(true);
    expect(mutationTypes.has("comparison_mutation")).toBe(true);
    expect(mutationTypes.has("logical_operator_mutation")).toBe(true);
    expect(mutationTypes.has("arithmetic_mutation")).toBe(true);
    expect(mutationTypes.has("flip_return_value")).toBe(true);
    expect(mutationTypes.has("strip_function_body")).toBe(true);
    expect(mutationTypes.has("string_literal_mutation")).toBe(true);

    for (const mutant of mutants) {
      expect(mutant.id).toMatch(/^mutant-\d+$/);
      expect(mutant.line).toBeGreaterThan(0);
      expect(mutant.column).toBeGreaterThan(0);
      expect(mutant.mutatedSource).not.toBe(code);
    }
  });

  test("generates comparison, logical, arithmetic, and return flip edge cases", () => {
    const code = `
      "use strict";
      export function evaluateLogic(a: number, b: number, flag: boolean): boolean {
        if (a !== b || a <= b || a >= b || a == b || a != b || a > b) {
          return false;
        }
        const x = (a / b) % 2;
        if (flag) {
          return true;
        }
        return false;
      }
      export function getNumber(): number {
        return 0;
      }
      export function getOtherNumber(): number {
        return 42;
      }
      export function emptyStr(): string {
        return "";
      }
      export function bareReturn(): void {
        return;
      }
    `;
    const mutants = generateMutants(code);
    expect(mutants.length).toBeGreaterThan(10);
    const descriptions = mutants.map((m) => m.description);
    expect(descriptions.some((d) => d.includes("!=="))).toBe(true);
    expect(descriptions.some((d) => d.includes("|| to &&"))).toBe(true);
    expect(descriptions.some((d) => d.includes("/ to *"))).toBe(true);
    expect(descriptions.some((d) => d.includes("% to *"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Flip return false to return true"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Flip bare return to return true"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Flip return 0 to return 1"))).toBe(true);
    expect(descriptions.some((d) => d.includes("Flip return 42 to return 0"))).toBe(true);
  });

  test("skips import/export declarations, require calls, and object keys during string mutation", () => {
    const code = `
      import { helper } from "./helper.ts";
      const config = { "api-key": "secret123" };
      const mod = require("module");
      export const title = "App";
    `;
    const mutants = generateMutants(code, { mutationTypes: ["string_literal_mutation"] });
    const originalTexts = mutants.map((m) => m.originalText);
    expect(originalTexts).toContain('"secret123"');
    expect(originalTexts).toContain('"App"');
    expect(originalTexts).not.toContain('"./helper.ts"');
    expect(originalTexts).not.toContain('"module"');
    expect(originalTexts).not.toContain('"api-key"');
  });

  test("passes mutation gate when all mutants are killed by the test runner", async () => {
    const implementationCode = `
      export function add(a: number, b: number): number {
        return a + b;
      }
    `;

    const runner = (mutatedSource: string, mutant: MutantRecord): MutationTestRunOutcome => {
      if (mutatedSource.includes("return a - b;") || mutant.mutationType === "flip_return_value") {
        return { passed: false, error: "Assertion error: expected 5 got -1" };
      }
      return { passed: false, exitCode: 1 };
    };

    const result = await runMutationGate(implementationCode, runner);
    expect(result.passed).toBe(true);
    expect(result.killedMutants).toBe(result.totalMutants);
    expect(result.survivedMutants).toBe(0);
    expect(result.mutationScore).toBe(100);
    expect(result.violations).toHaveLength(0);
  });

  test("fails mutation gate when mutants survive due to blind spots in tests", async () => {
    const implementationCode = `
      export function compute(val: number): boolean {
        if (val > 0) {
          return true;
        }
        return false;
      }
    `;

    const runner = (mutatedSource: string, mutant: MutantRecord): MutationTestRunOutcome => {
      if (mutant.description.includes("return true to return false")) {
        return { passed: false, exitCode: 1 };
      }
      return { passed: true, exitCode: 0 };
    };

    const result = await runMutationGate(implementationCode, runner, { minMutationScore: 100 });
    expect(result.passed).toBe(false);
    expect(result.survivedMutants).toBeGreaterThan(0);
    expect(result.mutationScore).toBeLessThan(100);
    expect(result.violations.length).toBe(result.survivedMutants);
    expect(result.violations[0]?.message).toContain(
      "survived: test suite passed without detecting intentional defect",
    );
  });

  test("supports maxMutants limit and non-strict survival mode", async () => {
    const code = `
      export function isPositive(x: number): boolean {
        if (x > 0) return true;
        return false;
      }
    `;
    const limitedMutants = generateMutants(code, { maxMutants: 2 });
    expect(limitedMutants.length).toBe(2);

    const runner = (src: string, m: MutantRecord): MutationTestRunOutcome => {
      if (m.id === "mutant-1") return { passed: false, exitCode: 1 };
      return { passed: true, exitCode: 0 };
    };

    const relaxedResult = await runMutationGate(code, runner, {
      minMutationScore: 50,
      strictZeroSurvival: false,
      maxMutants: 2,
    });
    expect(relaxedResult.passed).toBe(true);
    expect(relaxedResult.mutationScore).toBe(50);
  });

  test("handles runner errors gracefully", async () => {
    const code = `export function foo(): boolean { return true; }`;
    const throwingRunner = (): MutationTestRunOutcome => {
      throw new Error("Runner exploded");
    };
    const result = await runMutationGate(code, throwingRunner);
    expect(result.passed).toBe(false);
    expect(result.erroredMutants).toBe(result.totalMutants);
    expect(result.mutantResults[0]?.status).toBe("error");
    expect(result.mutantResults[0]?.details).toContain("Runner exploded");
  });

  test("handles code with 0 candidates gracefully", async () => {
    const code = `// Empty code with no mutations`;
    const runner = (): MutationTestRunOutcome => ({ passed: true });
    const result = await runMutationGate(code, runner);
    expect(result.passed).toBe(true);
    expect(result.totalMutants).toBe(0);
    expect(result.mutationScore).toBe(100);
  });
});

describe("Unified AntiMockEngine & Diagnostics", () => {
  test("evaluates complete suite passing all 3 pillars", async () => {
    const testSource = `
      test("adds numbers correctly", () => {
        const result = add(2, 3);
        expect(result).toBe(5);
      });
      test("handles negative numbers", () => {
        const result = add(-2, -3);
        expect(result).toBe(-5);
      });
    `;

    const implementationSource = `
      export function add(a: number, b: number): number {
        return a + b;
      }
    `;

    const runner = (): MutationTestRunOutcome => {
      return { passed: false, exitCode: 1 };
    };

    const input: AntiMockEvaluationInput = {
      testSource,
      implementationSource,
      testFileName: "tests/add.test.ts",
      implementationFileName: "src/add.ts",
      testRunner: runner,
    };

    const engine = new AntiMockEngine();
    const report = await engine.evaluate(input);

    expect(report.passed).toBe(true);
    expect(report.pillar1AstLinter.passed).toBe(true);
    expect(report.pillar2AssertionFloor.passed).toBe(true);
    expect(report.pillar3MutationGate?.passed).toBe(true);
    expect(report.totalViolationsCount).toBe(0);
    expect(report.summary).toContain("ANTI-MOCK AGP VALIDATION ENGINE REPORT");
    expect(report.summary).toContain("Overall Verdict: ✅ PASSED");
    expect(report.summary).toContain("Pillar 1: AST Early-Return & Mock Tautology Linter");
    expect(report.summary).toContain("Pillar 2: Assertion Count Floor Enforcer");
    expect(report.summary).toContain("Pillar 3: Mutation Gate Engine");
  });

  test("evaluates and produces diagnostic report when multiple pillars fail", async () => {
    const badTestSource = `
      test("empty test", () => {});
      test("tautology test", () => {
        expect(true).toBe(true);
      });
    `;

    const input: AntiMockEvaluationInput = {
      testSource: badTestSource,
      testFileName: "tests/bad.test.ts",
    };

    const report = await evaluateAntiMock(input);

    expect(report.passed).toBe(false);
    expect(report.pillar1AstLinter.passed).toBe(false);
    expect(report.pillar2AssertionFloor.passed).toBe(false);
    expect(report.pillar3MutationGate).toBeUndefined();
    expect(report.totalViolationsCount).toBeGreaterThanOrEqual(2);
    expect(report.summary).toContain("Overall Verdict: ❌ FAILED");
    expect(report.summary).toContain("empty_test_function");
    expect(report.summary).toContain("trivial_constant_assertion");
  });

  test("formats reports with survived mutants and diagnostic summaries", () => {
    const dummyReport: AntiMockDiagnosticReport = {
      passed: false,
      timestamp: "2026-08-22T10:00:00.000Z",
      testFileName: "tests/dummy.test.ts",
      implementationFileName: "src/dummy.ts",
      pillar1AstLinter: {
        passed: true,
        totalTestsAnalyzed: 1,
        violations: [],
        emptyTestCount: 0,
        trivialReturnCount: 0,
        mockTautologyCount: 0,
        trivialConstantCount: 0,
      },
      pillar2AssertionFloor: {
        passed: true,
        totalTests: 1,
        totalAssertions: 2,
        minAssertionsPerTest: 1,
        minAssertionsPerFile: 1,
        tests: [{ testName: "t1", assertionCount: 2, line: 1, column: 1, passed: true }],
        violations: [],
        averageAssertionsPerTest: 2,
      },
      pillar3MutationGate: {
        passed: false,
        totalMutants: 2,
        killedMutants: 1,
        survivedMutants: 1,
        erroredMutants: 0,
        mutationScore: 50,
        minMutationScore: 100,
        mutantResults: [],
        violations: [
          {
            mutantId: "mutant-1",
            mutationType: "invert_boolean",
            line: 10,
            column: 5,
            originalSnippet: "true",
            mutatedSnippet: "false",
            message: "Mutant survived: test suite passed without detecting intentional defect",
          },
        ],
      },
      totalViolationsCount: 1,
      summary: "",
    };

    const formatted = formatAntiMockReport(dummyReport);
    expect(formatted).toContain("Overall Verdict: ❌ FAILED");
    expect(formatted).toContain("Mutant: mutant-1");
    expect(formatted).toContain("Mutation Score: 50.00%");
  });

  test("AntiMockEngine class helper methods delegate appropriately", async () => {
    const engine = new AntiMockEngine({
      floorOptions: { minAssertionsPerTest: 3 },
    });

    const linterRes = engine.lintAst(`test("good", () => { expect(1 + 1).toBe(2); });`);
    expect(linterRes.passed).toBe(true);

    const floorRes = engine.enforceAssertionFloor(
      `test("single", () => { expect(1 + 1).toBe(2); });`,
    );
    expect(floorRes.passed).toBe(false);
    expect(floorRes.minAssertionsPerTest).toBe(3);

    const mutants = engine.generateMutants(`function check(x: boolean) { return x === true; }`);
    expect(mutants.length).toBeGreaterThan(0);

    const gateRes = await engine.runMutationGate(
      `function check(x: boolean) { return x === true; }`,
      () => ({ passed: false, exitCode: 1 }),
    );
    expect(gateRes.passed).toBe(true);

    const formatted = engine.formatReport({
      passed: true,
      timestamp: "2026-08-22T10:00:00.000Z",
      pillar1AstLinter: linterRes,
      pillar2AssertionFloor: floorRes,
      totalViolationsCount: 0,
      summary: "",
    });
    expect(formatted).toContain("ANTI-MOCK AGP VALIDATION ENGINE REPORT");
  });
});
