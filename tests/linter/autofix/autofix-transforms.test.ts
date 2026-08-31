import { describe, expect, it } from "bun:test";
import {
  autoFixSourceCode,
  isAutoFixResult,
} from "../../../olt/scripts/src/linter/ast/index.ts";

export const autofixTransformsSuiteName = "AST Source Code Auto-Fix Transforms";

describe(autofixTransformsSuiteName, () => {
  it("auto-fixes source code transforming ?? and as any", () => {
    const badCode = `
      // @ts-ignore
      const val = input ?? fallback;
      const obj = data as any;
    `;
    const autoFixResult = autoFixSourceCode(badCode, "test.ts");

    expect(isAutoFixResult(autoFixResult)).toBe(true);
    expect(autoFixResult.appliedFixesCount).toBeGreaterThan(0);
    expect(autoFixResult.fixedCode).not.toContain("@ts-ignore");
    expect(autoFixResult.fixedCode).not.toContain("as any");
    expect(autoFixResult.fixedCode).toContain("as unknown");
  });
});
