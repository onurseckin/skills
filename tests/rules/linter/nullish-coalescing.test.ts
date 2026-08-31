import { describe, expect, it } from "bun:test";
import { nullishCoalescingRule } from "../../../olt/scripts/src/linter/rules/nullish_coalescing.ts";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/runner.ts";

describe("Linter Rule: nullish_coalescing", () => {
  it("has correct rule metadata", () => {
    expect(nullishCoalescingRule.rule).toBe("nullish_coalescing");
    expect(typeof nullishCoalescingRule.checkNode).toBe("function");
    expect(typeof nullishCoalescingRule.generateFixSuggestion).toBe("function");
  });

  it("detects nullish coalescing operator (??)", () => {
    const code = `const count = inputCount ?? 0;`;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["nullish_coalescing"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].rule).toBe("nullish_coalescing");
    expect(result.violations[0].message).toContain("nullish coalescing operator (??)");
  });

  it("passes explicit ternary branching", () => {
    const code = `const count = inputCount !== undefined && inputCount !== null ? inputCount : 0;`;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["nullish_coalescing"] });
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it("generates explicit ternary replacement suggestion", () => {
    const suggestion = nullishCoalescingRule.generateFixSuggestion?.({
      rule: "nullish_coalescing",
      message: "Prohibited ??",
      file: "test.ts",
      line: 1,
      column: 1,
      snippet: "x ?? 10",
    });
    expect(suggestion?.suggestedReplacement).toBe("(x !== undefined && x !== null ? x : 10)");
  });
});
