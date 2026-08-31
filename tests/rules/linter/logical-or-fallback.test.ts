import { describe, expect, it } from "bun:test";
import { logicalOrFallbackRule } from "../../../olt/scripts/src/linter/rules/logical_or_fallback.ts";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/runner.ts";

describe("Linter Rule: logical_or_fallback", () => {
  it("has correct rule metadata", () => {
    expect(logicalOrFallbackRule.rule).toBe("logical_or_fallback");
    expect(typeof logicalOrFallbackRule.checkNode).toBe("function");
    expect(typeof logicalOrFallbackRule.generateFixSuggestion).toBe("function");
  });

  it("detects logical OR binary expressions (||)", () => {
    const code = `const name = inputName || "default";`;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["logical_or_fallback"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].rule).toBe("logical_or_fallback");
    expect(result.violations[0].message).toContain("logical OR operator (||)");
  });

  it("passes explicit ternary conditions", () => {
    const code = `const name = inputName !== undefined && inputName !== "" ? inputName : "default";`;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["logical_or_fallback"] });
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it("generates explicit boolean branching suggestion", () => {
    const suggestion = logicalOrFallbackRule.generateFixSuggestion?.({
      rule: "logical_or_fallback",
      message: "Prohibited ||",
      file: "test.ts",
      line: 1,
      column: 1,
      snippet: 'a || "default"',
    });
    expect(suggestion?.suggestedReplacement).toBe('(Boolean(a) ? a : "default")');
  });
});
