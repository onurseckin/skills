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
