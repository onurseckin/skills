import { describe, expect, it } from "bun:test";
import {
  lintSourceCode,
  type AstLintOptions,
} from "../../../olt/scripts/src/linter/ast/index.ts";

export const linterEngineSuiteName = "AST Linter Multi-Rule Aggregation & Selective Filtering";

describe(linterEngineSuiteName, () => {
  it("aggregates all rule violations accurately in one source file", () => {
    const code = `
      // @ts-ignore
      const openaiService: any = client ?? backupClient;
      const val = list!.item || "fallback";
    `;
    const result = lintSourceCode(code, "bad.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.compiler_suppression).toBe(1);
    expect(result.summaryByRule.vendor_leak).toBeGreaterThanOrEqual(1);
    expect(result.summaryByRule.any_type).toBe(1);
    expect(result.summaryByRule.nullish_coalescing).toBe(1);
    expect(result.summaryByRule.non_null_assertion).toBe(1);
    expect(result.summaryByRule.logical_or_fallback).toBe(1);
  });

  it("filters rules via enabledRules option", () => {
    const code = `
      const x: any = 1;
      const y = a ?? b;
    `;
    const options: AstLintOptions = {
      enabledRules: ["nullish_coalescing"],
    };
    const result = lintSourceCode(code, "test.ts", options);

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.nullish_coalescing).toBe(1);
    expect(result.summaryByRule.any_type).toBe(0);
  });

  it("skips rules via disabledRules option", () => {
    const code = `
      const x: any = 1;
      const y = a ?? b;
    `;
    const options: AstLintOptions = {
      disabledRules: ["any_type"],
    };
    const result = lintSourceCode(code, "test.ts", options);

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.any_type).toBe(0);
    expect(result.summaryByRule.nullish_coalescing).toBe(1);
  });
});
