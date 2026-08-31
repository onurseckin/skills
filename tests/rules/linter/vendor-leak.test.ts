import { describe, expect, it } from "bun:test";
import { vendorLeakRule } from "../../../olt/scripts/src/linter/rules/vendor_leak.ts";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/runner.ts";

describe("Linter Rule: vendor_leak", () => {
  it("has correct rule metadata", () => {
    expect(vendorLeakRule.rule).toBe("vendor_leak");
    expect(typeof vendorLeakRule.checkNode).toBe("function");
  });

  it("detects prohibited vendor identifiers in variable names", () => {
    const code = `const openaiClient = createClient();`;
    const result = lintSourceCode(code, "test.ts", {
      enabledRules: ["vendor_leak"],
      vendorList: ["openai", "anthropic"],
    });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations[0].rule).toBe("vendor_leak");
    expect(result.violations[0].message).toContain("openai");
  });

  it("detects prohibited vendor identifiers in imports", () => {
    const code = `import { AnthropicSDK } from "@anthropic-ai/sdk";`;
    const result = lintSourceCode(code, "test.ts", {
      enabledRules: ["vendor_leak"],
      vendorList: ["openai", "anthropic"],
    });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
  });

  it("passes clean vendor-neutral identifiers", () => {
    const code = `
      export interface ModelClient {
        readonly endpoint: string;
      }
      export function createClient(): ModelClient {
        return { endpoint: "/api/v1" };
      }
    `;
    const result = lintSourceCode(code, "test.ts", {
      enabledRules: ["vendor_leak"],
      vendorList: ["openai", "anthropic"],
    });
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });
});
