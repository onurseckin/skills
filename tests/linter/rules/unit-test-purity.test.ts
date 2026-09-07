import { describe, expect, it } from "bun:test";
import { lintSourceCode } from "../../../olt/scripts/src/linter/ast/index.ts";
import { unitTestPurityRule } from "../../../olt/scripts/src/linter/rules/testing/unit_test_purity.ts";

export const unitTestPuritySuiteName = "AST Unit Test Purity Rule (unit_test_purity)";

describe(unitTestPuritySuiteName, () => {
  it("exports the correct rule identifier", () => {
    expect(unitTestPurityRule.rule).toBe("unit_test_purity");
  });

  it("detects real filesystem imports in test files", () => {
    const code = `
      import * as fs from "node:fs";
      import { writeFileSync } from "fs";
      test("real fs import", () => {
        expect(1).toBe(1);
      });
    `;
    const result = lintSourceCode(code, "tests/fs-import.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unit_test_purity).toBe(2);
    expect(result.violations[0]?.rule).toBe("unit_test_purity");
    expect(result.violations[0]?.message).toContain("Real filesystem import");
  });

  it("detects real filesystem require calls", () => {
    const code = `
      const fs = require("node:fs");
      test("require fs", () => {
        expect(1).toBe(1);
      });
    `;
    const result = lintSourceCode(code, "tests/require-fs.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unit_test_purity).toBe(1);
    expect(result.violations[0]?.message).toContain("Real filesystem require");
  });

  it("detects real filesystem dynamic import calls", () => {
    const code = `
      test("dynamic fs import", async () => {
        const fs = await import("node:fs");
        expect(fs).toBeDefined();
      });
    `;
    const result = lintSourceCode(code, "tests/dynamic-fs.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unit_test_purity).toBe(1);
    expect(result.violations[0]?.message).toContain("Real filesystem dynamic import");
  });

  it("ignores type-only imports from node:fs", () => {
    const code = `
      import type { Stats } from "node:fs";
      import type { BufferEncoding } from "fs";
      test("type only fs import", () => {
        const x: number = 42;
        expect(x).toBe(42);
      });
    `;
    const result = lintSourceCode(code, "tests/type-only.test.ts");

    expect(result.summaryByRule.unit_test_purity).toBe(0);
  });

  it("detects unmocked real filesystem method calls", () => {
    const code = `
      test("unmocked fs calls", () => {
        fs.writeFileSync("output.txt", "bad");
        const data = fs.readFileSync("input.txt", "utf8");
        mkdirSync("scratch");
      });
    `;
    const result = lintSourceCode(code, "tests/unmocked-fs.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unit_test_purity).toBe(3);
    expect(result.violations.some((v) => v.message.includes("fs.writeFileSync()"))).toBe(true);
    expect(result.violations.some((v) => v.message.includes("fs.readFileSync()"))).toBe(true);
    expect(result.violations.some((v) => v.message.includes("mkdirSync()"))).toBe(true);
  });

  it("permits VirtualMemoryFS and virtual fixture operations", () => {
    const code = `
      test("in-memory virtual fs usage", () => {
        vfs.writeFileSync("/app/file.txt", "pure memory");
        const read = mockFs.readFileSync("/app/file.txt", "utf8");
        memFs.mkdirSync("/tmp/virtual");
        fsMock.existsSync("/test");
        expect(read).toBe("pure memory");
      });
    `;
    const result = lintSourceCode(code, "tests/virtual-fs.test.ts");

    expect(result.summaryByRule.unit_test_purity).toBe(0);
  });

  it("detects subprocess imports and invocations", () => {
    const code = `
      import { execSync } from "node:child_process";
      import cp from "child_process";

      test("subprocess calls", () => {
        execSync("git status");
        cp.spawnSync("echo", ["hi"]);
      });
    `;
    const result = lintSourceCode(code, "tests/subprocess.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unit_test_purity).toBe(4);
    expect(result.violations.some((v) => v.message.includes("Subprocess import"))).toBe(true);
    expect(result.violations.some((v) => v.message.includes("execSync()"))).toBe(true);
    expect(result.violations.some((v) => v.message.includes("cp.spawnSync()"))).toBe(true);
  });

  it("detects subprocess dynamic import calls", () => {
    const code = `
      test("dynamic subprocess import", async () => {
        const cp = await import("child_process");
        expect(cp).toBeDefined();
      });
    `;
    const result = lintSourceCode(code, "tests/dynamic-cp.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unit_test_purity).toBe(1);
    expect(result.violations[0]?.message).toContain("Subprocess dynamic import");
  });

  it("detects Bun subprocess execution primitives", () => {
    const code = `
      test("bun subprocess execution", () => {
        Bun.spawn(["git", "status"]);
        Bun.spawnSync(["ls", "-la"]);
        Bun.$\`echo hello\`;
      });
    `;
    const result = lintSourceCode(code, "tests/bun-subprocess.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unit_test_purity).toBe(3);
    expect(result.violations.some((v) => v.message.includes("Bun.spawn()"))).toBe(true);
    expect(result.violations.some((v) => v.message.includes("Bun.spawnSync()"))).toBe(true);
    expect(result.violations.some((v) => v.message.includes("Bun.$"))).toBe(true);
  });

  it("detects heavyweight ts.createProgram in unit tests", () => {
    const code = `
      test("heavyweight ast check in unit test", () => {
        const program = ts.createProgram(["src/index.ts"], {});
        expect(program).toBeDefined();
      });
    `;
    const result = lintSourceCode(code, "tests/ast-heavy.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unit_test_purity).toBe(1);
    expect(result.violations[0]?.message).toContain("ts.createProgram()");
  });

  it("detects heavyweight ts.createLanguageService and ts.readConfigFile", () => {
    const code = `
      test("heavyweight language service and config in unit test", () => {
        ts.createLanguageService({} as any);
        ts.readConfigFile("tsconfig.json", () => "");
      });
    `;
    const result = lintSourceCode(code, "tests/ast-lang-service.test.ts");

    expect(result.valid).toBe(false);
    expect(result.summaryByRule.unit_test_purity).toBe(2);
    expect(result.violations.some((v) => v.message.includes("ts.createLanguageService()"))).toBe(
      true,
    );
    expect(result.violations.some((v) => v.message.includes("ts.readConfigFile()"))).toBe(true);
  });

  it("permits synthetic in-memory AST parsing in unit tests", () => {
    const code = `
      test("in-memory ast string parsing", () => {
        const sf = ts.createSourceFile("inline.ts", "const x = 1;", ts.ScriptTarget.Latest);
        expect(sf.statements.length).toBe(1);
      });
    `;
    const result = lintSourceCode(code, "tests/ast-synthetic.test.ts");

    expect(result.summaryByRule.unit_test_purity).toBe(0);
  });

  it("does not flag filesystem or subprocess in non-test source files", () => {
    const code = `
      import * as fs from "node:fs";
      import { execSync } from "node:child_process";

      export function buildApp(): void {
        fs.writeFileSync("dist/app.js", "built");
        execSync("echo done");
      }
    `;
    const result = lintSourceCode(code, "src/core/builder.ts");

    expect(result.summaryByRule.unit_test_purity).toBe(0);
  });

  it("generates appropriate fix suggestions for purity violations", () => {
    const fsFix = unitTestPurityRule.generateFixSuggestion?.({
      rule: "unit_test_purity",
      message: "Real filesystem import 'node:fs' detected.",
      file: "test.ts",
      line: 1,
      column: 1,
      snippet: "import * as fs from 'node:fs';",
    });
    expect(fsFix?.suggestedReplacement).toContain("VirtualMemoryFS");

    const cpFix = unitTestPurityRule.generateFixSuggestion?.({
      rule: "unit_test_purity",
      message: "Subprocess call 'cp.execSync()' detected.",
      file: "test.ts",
      line: 2,
      column: 1,
      snippet: "cp.execSync('ls');",
    });
    expect(cpFix?.suggestedReplacement).toContain("virtual adapter");

    const astFix = unitTestPurityRule.generateFixSuggestion?.({
      rule: "unit_test_purity",
      message: "Heavyweight 'ts.createProgram()' detected in unit test.",
      file: "test.ts",
      line: 3,
      column: 1,
      snippet: "ts.createProgram()",
    });
    expect(astFix?.suggestedReplacement).toContain("task:check");
  });
});
