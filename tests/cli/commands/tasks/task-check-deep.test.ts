import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  collectSourceFilesRecursively,
  computeTaskCheckVerdict,
  findNearestTsconfig,
  formatTaskCheckMarkdown,
  isSupportedSourceFile,
  performAstLintCheck,
  performIncrementalTypecheck,
  readRunTasks,
  resolveTargetFiles,
  SUPPORTED_EXTENSIONS,
  taskCheckCommand,
  type LintCheckResult,
  type TaskCheckSummary,
  type TypeCheckDiagnostic,
  type TypeCheckResult,
} from "../../../../olt/scripts/src/cli/commands/task-check.ts";
import * as astLinter from "../../../../olt/scripts/src/linter/ast/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("task-check deep coverage: helpers and file resolution", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });
  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("SUPPORTED_EXTENSIONS and isSupportedSourceFile exhaustive check", () => {
    for (const ext of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(SUPPORTED_EXTENSIONS.includes(ext) && isSupportedSourceFile(`sample${ext}`)).toBe(
        true,
      );
    }
    expect(isSupportedSourceFile("test.py") || isSupportedSourceFile("readme.md")).toBe(false);
  });

  test("collectSourceFilesRecursively, readRunTasks, and resolveTargetFiles", async () => {
    expect(collectSourceFilesRecursively("/non-existent-folder")).toEqual([]);
    expect(readRunTasks("/non-existent-run")).toEqual({});
    expect(() => resolveTargetFiles({ taskId: "T1" })).toThrow(HarnessError);

    const root = await createVirtualDir("res-deep");
    const nested = join(root, "src", "nested");
    await mkdir(nested, { recursive: true });
    const fileA = join(nested, "a.ts");
    await writeFile(fileA, "export const a = 1;");
    expect(collectSourceFilesRecursively(root).length).toBe(1);

    const runRoot = initRun(root, "run-t", new TextEncoder().encode("p"), "file", true);
    transact(runRoot, "coordinator", "setup", {}, (draft) => {
      draft.tasks = {
        T1: { id: "T1", status: "ready", target_files: [fileA], write_scope: [nested] },
      };
    });
    expect(resolveTargetFiles({ runRoot, taskId: "T1" }).length).toBe(1);
    expect(resolveTargetFiles({ fileFlags: [fileA, nested, "/non-existent.ts"] }).length).toBe(2);
  });
});

describe("task-check deep coverage: typecheck and AST linting", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });
  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("findNearestTsconfig handles existing, missing, and non-virtual paths", async () => {
    const root = await createVirtualDir("tsconfig-deep");
    const cfgPath = join(root, "tsconfig.json");
    await writeFile(cfgPath, JSON.stringify({ compilerOptions: {} }));
    const fPath = join(root, "mod.ts");
    await writeFile(fPath, "export const y = 2;");
    expect(findNearestTsconfig(fPath)).toBe(cfgPath);
    expect(findNearestTsconfig("/virtual/empty-dir/index.ts")).toBeUndefined();
  });

  test("performIncrementalTypecheck handles empty, clean, and error cases in test mode", async () => {
    expect(performIncrementalTypecheck([])).toEqual({
      passed: true,
      totalFiles: 0,
      totalErrors: 0,
      totalWarnings: 0,
      diagnostics: [],
    });
    const root = await createVirtualDir("typecheck-deep");
    const cleanFile = join(root, "clean.ts");
    await writeFile(cleanFile, "export const val: number = 42;\n");
    expect(performIncrementalTypecheck([cleanFile]).passed).toBe(true);

    const errFile = join(root, "bad.ts");
    await writeFile(errFile, "export const val: number = 'str';\n");
    const errRes = performIncrementalTypecheck([errFile]);
    expect(errRes.passed).toBe(false);
    expect(errRes.diagnostics[0]?.snippet).toBeDefined();
  });

  test("performIncrementalTypecheck non-test mode handles fallback files and group compilation", async () => {
    const root = await createVirtualDir("typecheck-fb");
    const origCwd = process.cwd();
    const origArgv = [...process.argv];
    const origEnv = process.env["NODE_ENV"];
    const origBunTest = process.env["BUN_TEST"];
    try {
      process.env["NODE_ENV"] = "production";
      delete process.env["BUN_TEST"];
      (process.argv as string[]).length = 0;
      (process.argv as string[]).push("bun", "run", "cli.js");

      process.chdir(root);
      const fbFile = join(root, "orphan.ts");
      await writeFile(fbFile, "export const n: number = 'bad';");
      const res = performIncrementalTypecheck([fbFile]);
      expect(res.passed).toBe(false);
      expect(res.diagnostics.length).toBeGreaterThan(0);
    } finally {
      process.chdir(origCwd);
      (process.argv as string[]).length = 0;
      (process.argv as string[]).push(...origArgv);
      if (origEnv !== undefined) process.env["NODE_ENV"] = origEnv;
      else delete process.env["NODE_ENV"];
      if (origBunTest !== undefined) process.env["BUN_TEST"] = origBunTest;
    }
  });

  test("performAstLintCheck handles empty, clean, violations, custom rule, and exception", async () => {
    expect(performAstLintCheck([]).passed).toBe(true);
    const root = await createVirtualDir("ast-deep");
    const cleanFile = join(root, "clean.ts");
    await writeFile(cleanFile, "export const num = 123;\n");
    expect(performAstLintCheck([cleanFile]).passed).toBe(true);

    const spyCustom = spyOn(astLinter, "lintFile").mockReturnValue({
      violations: [
        {
          rule: "custom_rule" as any,
          file: cleanFile,
          line: 1,
          column: 1,
          snippet: "",
          message: "custom",
        },
      ],
    } as any);
    const customRes = performAstLintCheck([cleanFile]);
    expect(customRes.passed).toBe(false);
    expect(customRes.summaryByRule["custom_rule"]).toBe(1);
    spyCustom.mockRestore();

    const spyCrash = spyOn(astLinter, "lintFile").mockImplementation(() => {
      throw new Error("lint crash");
    });
    const crashRes = performAstLintCheck([cleanFile]);
    expect(crashRes.passed).toBe(false);
    expect(crashRes.violations[0]?.rule).toBe("compiler_suppression");
    spyCrash.mockRestore();
  });
});

describe("task-check deep coverage: markdown formatter & command execution", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });
  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("formatTaskCheckMarkdown and computeTaskCheckVerdict format diagnostics and verdicts", () => {
    const pTc: TypeCheckResult = {
      passed: true,
      totalFiles: 1,
      totalErrors: 0,
      totalWarnings: 0,
      diagnostics: [],
    };
    const pLint: LintCheckResult = {
      passed: true,
      totalFiles: 1,
      totalViolations: 0,
      violations: [],
      summaryByRule: {},
    };
    expect(
      formatTaskCheckMarkdown({
        passed: true,
        filesChecked: ["src/s.ts"],
        durationMs: 12,
        format: "markdown",
        markdown: "",
        typecheck: pTc,
        lint: pLint,
      }),
    ).toContain("PASS");

    const diags = Array.from({ length: 12 }, (_, i) => ({
      file: "m.ts",
      line: i + 1,
      column: 1,
      code: 1000 + i,
      message: `Err ${i + 1}`,
      category: "error" as const,
    }));
    const failSummary: TaskCheckSummary = {
      passed: false,
      filesChecked: ["m.ts"],
      durationMs: 88,
      format: "markdown",
      markdown: "",
      typecheck: {
        passed: false,
        totalFiles: 1,
        totalErrors: 12,
        totalWarnings: 0,
        diagnostics: diags,
      },
    };
    expect(formatTaskCheckMarkdown(failSummary)).toContain("additional type errors");

    expect(computeTaskCheckVerdict(undefined, undefined)).toBe(false);
    expect(computeTaskCheckVerdict(pTc, pLint)).toBe(true);
    expect(computeTaskCheckVerdict(pTc, { ...pLint, passed: false })).toBe(false);
  });

  test("taskCheckCommand execution with lint only, format markdown, and error branches", async () => {
    const root = await createVirtualDir("cmd-deep");
    const runRoot = initRun(root, "run-check", new TextEncoder().encode("prompt"), "file", true);
    const validFile = join(root, "valid.ts");
    await writeFile(validFile, "export const z = 99;\n");

    const emptyDir = join(root, "empty-dir");
    await mkdir(emptyDir, { recursive: true });
    await expect(taskCheckCommand({ file: [emptyDir] })).rejects.toThrow(
      "No valid source files found matching --file arguments",
    );

    const lintOnlyRes = await taskCheckCommand({
      run: runRoot,
      file: validFile,
      lint: true,
      format: "markdown",
    });
    expect(lintOnlyRes.passed && !lintOnlyRes.typecheck && !!lintOnlyRes.lint).toBe(true);

    transact(runRoot, "coordinator", "setup", {}, (draft) => {
      draft.tasks = {
        "task-deep": {
          id: "task-deep",
          status: "ready",
          target_files: [validFile],
          write_scope: [],
        },
      };
    });

    const taskRes = await taskCheckCommand({
      run: runRoot,
      task: "task-deep",
      actor: "custom-mechanic",
    });
    expect(taskRes.passed && taskRes.task_id === "task-deep" && !!taskRes.evidence_path).toBe(true);
  });
});
