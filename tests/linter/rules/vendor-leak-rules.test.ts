import { describe, expect, it } from "bun:test";
import {
  lintSourceCode,
  type AstLintOptions,
} from "../../../olt/scripts/src/linter/ast/index.ts";

export const vendorLeakRulesSuiteName = "AST Vendor Identifier Leak Rules";

describe(vendorLeakRulesSuiteName, () => {
  it("detects prohibited vendor identifiers across camelCase, PascalCase, snake_case", () => {
    const code = `
      const anthropicClient = new Client();
      class OpenAiService {}
      function call_gemini_api() {}
      const claude_key = "secret";
      const chatgptResponse = {};
    `;
    const result = lintSourceCode(code, "test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.vendor_leak).toBe(5);
  });

  it("detects vendor names in import statements and module specifiers", () => {
    const code = `
      import { Anthropic } from "@anthropic-ai/sdk";
      import OpenAI from "openai";
    `;
    const result = lintSourceCode(code, "test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.vendor_leak).toBeGreaterThanOrEqual(2);
  });

  it("detects vendor names in export declarations and require calls", () => {
    const code = `
      export { geminiClient } from "./gemini";
      const openai = require("openai");
    `;
    const result = lintSourceCode(code, "test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.vendor_leak).toBeGreaterThanOrEqual(2);
  });

  it("respects custom vendor names supplied in options", () => {
    const code = `
      const customVendorApi = create();
      const regularService = standard();
    `;
    const options: AstLintOptions = {
      vendorNames: ["customvendor"],
    };
    const result = lintSourceCode(code, "test.ts", options);

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.vendor_leak).toBe(1);
  });

  it("passes neutral non-vendor identifiers", () => {
    const code = `
      const harness = new TestHarness();
      const coordinator = new Coordinator();
      const telemetry = collectMetrics();
    `;
    const result = lintSourceCode(code, "clean.ts");

    expect(result.valid).toBe(true);
    expect(result.summaryByRule.vendor_leak).toBe(0);
  });
});
