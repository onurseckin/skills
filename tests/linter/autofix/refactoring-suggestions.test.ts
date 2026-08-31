import { describe, expect, it } from "bun:test";
import {
  generateFixSuggestion,
  lintSourceCode,
  suggestRefactorings,
  type AstLintViolation,
} from "../../../olt/scripts/src/linter/ast/index.ts";

export const refactoringSuggestionsSuiteName = "AST Refactoring Suggestions Generator";

describe(refactoringSuggestionsSuiteName, () => {
  it("generates refactoring suggestions for violations", () => {
    const violation: AstLintViolation = {
      rule: "nullish_coalescing",
      message: "Prohibited ??",
      file: "test.ts",
      line: 5,
      column: 10,
      snippet: "val ?? 'default'",
    };

    const suggestion = generateFixSuggestion(violation);
    expect(suggestion.rule).toBe("nullish_coalescing");
    expect(suggestion.suggestedReplacement).toContain("!==");
    expect(suggestion.explanation).toContain("explicit nullish checks");
  });

  it("suggests refactorings for complete lint results", () => {
    const code = `
      const x: any = 1;
      const y = a ?? b;
    `;
    const result = lintSourceCode(code, "test.ts");
    const suggestions = suggestRefactorings(result, code);

    expect(suggestions.length).toBe(2);
    expect(suggestions[0] !== undefined).toBe(true);
    expect(suggestions[1] !== undefined).toBe(true);
  });
});
