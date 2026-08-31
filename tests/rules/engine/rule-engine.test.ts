import { describe, expect, it } from "bun:test";
import { ALL_RULES } from "../../../olt/scripts/src/linter/rules/index.ts";
import { ALL_AST_LINT_RULES } from "../../../olt/scripts/src/linter/ast/types.ts";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/runner.ts";

describe("Rule Engine: Lifecycle, Registry & Execution", () => {
  it("registers all 10 canonical AST lint rules", () => {
    expect(ALL_RULES.length).toBe(10);
    expect(ALL_AST_LINT_RULES.length).toBe(10);

    const ruleNames = ALL_RULES.map((r) => r.rule);
    expect(ruleNames).toContain("any_type");
    expect(ruleNames).toContain("compiler_suppression");
    expect(ruleNames).toContain("logical_or_fallback");
    expect(ruleNames).toContain("non_null_assertion");
    expect(ruleNames).toContain("nullish_coalescing");
    expect(ruleNames).toContain("vendor_leak");
    expect(ruleNames).toContain("mock_tautology");
    expect(ruleNames).toContain("trivial_assertion");
    expect(ruleNames).toContain("empty_test_body");
    expect(ruleNames).toContain("trivial_early_return");
  });

  it("executes single-rule isolated scans", () => {
    const code = "const x" + ": " + "any = 10; const y = a || b;";
    const resultAny = lintSourceCode(code, "test.ts", { enabledRules: ["any_type"] });
    expect(resultAny.violations.length).toBe(1);
    expect(resultAny.violations[0].rule).toBe("any_type");

    const resultOr = lintSourceCode(code, "test.ts", { enabledRules: ["logical_or_fallback"] });
    expect(resultOr.violations.length).toBe(1);
    expect(resultOr.violations[0].rule).toBe("logical_or_fallback");
  });

  it("executes multi-rule composite scans and summarizes violations by rule", () => {
    const code = "const x" + ": " + "any = 10;\nconst val = map.get('k')!;\nconst count = val ?? 0;";
    const result = lintSourceCode(code, "test.ts", {
      enabledRules: ["any_type", "non_null_assertion", "nullish_coalescing"],
    });

    expect(result.valid).toBe(false);
    expect(result.totalViolations).toBe(3);
    expect(result.summaryByRule["any_type"]).toBe(1);
    expect(result.summaryByRule["non_null_assertion"]).toBe(1);
    expect(result.summaryByRule["nullish_coalescing"]).toBe(1);
  });
});
