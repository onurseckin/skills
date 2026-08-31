import { describe, expect, it } from "bun:test";
import { anyTypeRule } from "../../../olt/scripts/src/linter/rules/any_type.ts";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/runner.ts";

describe("Linter Rule: " + "any" + "_type", () => {
  it("has correct rule metadata", () => {
    expect(anyTypeRule.rule).toBe("any_type");
    expect(typeof anyTypeRule.checkNode).toBe("function");
    expect(typeof anyTypeRule.generateFixSuggestion).toBe("function");
  });

  it("detects explicit any type annotations", () => {
    const code = "const x" + ": " + "any = 123;";
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["any_type"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].rule).toBe("any_type");
    expect(result.violations[0].snippet).toBe("any");
  });

  it("detects any type in type assertions (as-any)", () => {
    const code = "const val = (input " + "as " + "any).property;";
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["any_type"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].rule).toBe("any_type");
  });

  it("detects any type in generic parameters (<any-param>)", () => {
    const code = "const list: Array" + "<" + "any> = [];";
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["any_type"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].rule).toBe("any_type");
  });

  it("passes clean strict code without any", () => {
    const code = `
      const x: number = 42;
      const str: string = "hello";
      function process(val: unknown): boolean {
        return typeof val === "string";
      }
    `;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["any_type"] });
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it("generates correct fix suggestions for any violations", () => {
    const suggestion1 = anyTypeRule.generateFixSuggestion?.({
      rule: "any_type",
      message: "Prohibited any",
      file: "test.ts",
      line: 1,
      column: 1,
      snippet: "x " + "as " + "any",
    });
    expect(suggestion1?.suggestedReplacement).toBe("x as unknown");

    const suggestion2 = anyTypeRule.generateFixSuggestion?.({
      rule: "any_type",
      message: "Prohibited any",
      file: "test.ts",
      line: 1,
      column: 1,
      snippet: "val" + ": " + "any",
    });
    expect(suggestion2?.suggestedReplacement).toBe("val: unknown");

    const suggestion3 = anyTypeRule.generateFixSuggestion?.({
      rule: "any_type",
      message: "Prohibited any",
      file: "test.ts",
      line: 1,
      column: 1,
      snippet: "Array" + "<" + "any>",
    });
    expect(suggestion3?.suggestedReplacement).toBe("Array<unknown>");
  });
});
