import { describe, expect, it } from "bun:test";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/index.ts";

export const testAntiPatternsSuiteName = "AST Test Anti-Pattern Rules";

describe(testAntiPatternsSuiteName, () => {
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
