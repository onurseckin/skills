import { describe, expect, it } from "bun:test";
import { nonNullAssertionRule } from "../../../olt/scripts/src/linter/rules/non_null_assertion.ts";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/runner.ts";

describe("Linter Rule: non_null_assertion", () => {
  it("has correct rule metadata", () => {
    expect(nonNullAssertionRule.rule).toBe("non_null_assertion");
    expect(typeof nonNullAssertionRule.checkNode).toBe("function");
  });

  it("detects non-null assertion expressions (!)", () => {
    const code = `const item = map.get("key")!;`;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["non_null_assertion"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].rule).toBe("non_null_assertion");
    expect(result.violations[0].message).toContain("non-null assertion operator (!)");
  });

  it("passes safe optional chaining and guarded access", () => {
    const code = `
      const item = map.get("key");
      if (item !== undefined) {
        console.log(item);
      }
    `;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["non_null_assertion"] });
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });
});
