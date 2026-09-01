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

  test("withholds a PASSED verdict when no test runner is supplied to prove mutation survival was checked", async () => {
    const cleanTestSource = `
      test("adds two numbers", () => {
        expect(add(2, 3)).toBe(5);
      });
    `;

    const input: AntiMockEvaluationInput = {
      testSource: cleanTestSource,
      implementationSource: `
        export function add(a: number, b: number): number {
          return a + b;
        }
      `,
      testFileName: "tests/add.test.ts",
      implementationFileName: "src/add.ts",
    };

    const report = await evaluateAntiMock(input);

    expect(report.pillar1AstLinter.passed).toBe(true);
    expect(report.pillar2AssertionFloor.passed).toBe(true);
    expect(report.pillar3MutationGate).toBeUndefined();
    expect(report.passed).toBe(false);
    expect(report.summary).toContain("Overall Verdict: ❌ FAILED");
    expect(report.summary).toContain("mutation gate was not run");
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
