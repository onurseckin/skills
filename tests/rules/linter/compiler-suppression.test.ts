import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { compilerSuppressionRule } from "../../../olt/scripts/src/linter/rules/compiler_suppression.ts";
import { lintFile, lintSourceCode } from "../../../olt/scripts/src/linter/ast/runner.ts";
import { cleanupVirtualRulesFS, setupVirtualRulesFS } from "../fixture.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";

let vfs: VirtualMemoryFS;

beforeEach(() => {
  vfs = setupVirtualRulesFS();
});

afterEach(cleanupVirtualRulesFS);

describe("Linter Rule: compiler_suppression", () => {
  it("has correct rule metadata", () => {
    expect(compilerSuppressionRule.rule).toBe("compiler_suppression");
    expect(typeof compilerSuppressionRule.checkSourceFile).toBe("function");
  });

  it("detects @" + "ts-ignore directives in comments", () => {
    const code = `// @` + `ts-ignore\nconst x: number = "bad";`;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["compiler_suppression"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].rule).toBe("compiler_suppression");
    expect(result.violations[0].message).toContain("@" + "ts-ignore");
  });

  it("detects @" + "ts-expect-error directives in block comments", () => {
    const code = `/* @` + `ts-expect-error */\nconst x: number = "bad";`;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["compiler_suppression"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].rule).toBe("compiler_suppression");
  });

  it("detects @" + "ts-nocheck in file headers", () => {
    const code = `// @` + `ts-nocheck\nexport const ok = 1;`;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["compiler_suppression"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
  });

  it("detects eslint-" + "disable directives", () => {
    const code = `/* eslint-` + `disable */\nconst x = 1;`;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["compiler_suppression"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
  });

  it("passes clean comments with standard prose", () => {
    const code = `
      // This is a normal comment explaining the architecture.
      /* Multi-line comment without any suppressions */
      export function add(a: number, b: number): number {
        return a + b;
      }
    `;
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["compiler_suppression"] });
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it("provides clean removal fix suggestion", () => {
    const suggestion = compilerSuppressionRule.generateFixSuggestion?.({
      rule: "compiler_suppression",
      message: "Prohibited directive",
      file: "test.ts",
      line: 1,
      column: 1,
      snippet: "// @" + "ts-ignore",
    });
    expect(suggestion?.suggestedReplacement).toBe("");
    expect(suggestion?.explanation).toContain("Remove compiler suppression");
  });

  it("lints virtual file via lintFile on VirtualMemoryFS", () => {
    const filePath = "/virtual/rules-scratch/test-suppression.ts";
    vfs.writeFileSync(filePath, "// @" + "ts-ignore with trailing comment\nexport const x = 1;");
    const result = lintFile(filePath, { enabledRules: ["compiler_suppression"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].message).toContain("@" + "ts-ignore");
  });

  it("detects multi-directive comments and eslint-disable variations", () => {
    const code = "/* eslint-disable-next-line */\n// @" + "ts-expect-error reason\nconst x = 1;";
    const result = lintSourceCode(code, "test.ts", { enabledRules: ["compiler_suppression"] });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(2);
  });
});
