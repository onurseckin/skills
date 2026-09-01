import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  collectSourceFilesRecursively,
  computeTaskCheckVerdict,
  formatTaskCheckMarkdown,
  isSupportedSourceFile,
  readRunTasks,
  resolveTargetFiles,
  taskCheckCommand,
  type TaskCheckSummary,
  type TypeCheckDiagnostic,
} from "../../../../../olt/scripts/src/cli/commands/task-check.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("task:check - Comprehensive Command & Scope Suite", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("isSupportedSourceFile and collectSourceFilesRecursively classify files", async () => {
    expect(isSupportedSourceFile("test.ts")).toBe(true);
    expect(isSupportedSourceFile("test.tsx")).toBe(true);
    expect(isSupportedSourceFile("test.mts")).toBe(true);
    expect(isSupportedSourceFile("test.cts")).toBe(true);
    expect(isSupportedSourceFile("test.js")).toBe(true);
    expect(isSupportedSourceFile("test.jsx")).toBe(true);
    expect(isSupportedSourceFile("test.mjs")).toBe(true);
    expect(isSupportedSourceFile("test.cjs")).toBe(true);
    expect(isSupportedSourceFile("test.json")).toBe(false);
    expect(isSupportedSourceFile("test.txt")).toBe(false);

    const root = await createVirtualDir("collect-recursively");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;");
    const collected = collectSourceFilesRecursively(root);
    expect(collected.length).toBe(1);
    expect(collected[0]?.endsWith("a.ts")).toBe(true);
    expect(collectSourceFilesRecursively("/non-existent-dir")).toEqual([]);
  });

  test("resolveTargetFiles and readRunTasks handle all scopes and fallbacks", async () => {
    const root = await createVirtualDir("target-files-scope");
    const runRoot = initRun(
      root,
      "run-scope-test",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );
    const tsFile = join(root, "single-file.ts");
    await writeFile(tsFile, "export const val = 1;\n");
    const subDir = join(root, "nested-scope");
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, "nested.ts"), "export const nested = 2;\n");

    transact(runRoot, "coordinator", "setup-tasks", {}, (draft) => {
      draft.tasks = {
        "task-alpha": {
          id: "task-alpha",
          status: "ready",
          target_files: [tsFile],
          write_scope: [subDir, join(root, "non-existent.ts")],
        },
      };
    });

    const taskScoped = resolveTargetFiles({ runRoot, taskId: "task-alpha" });
    expect(taskScoped.length).toBe(3);
    expect(taskScoped.includes(tsFile)).toBe(true);

    const wholeRunScoped = resolveTargetFiles({ runRoot });
    expect(wholeRunScoped.length).toBe(3);
    expect(wholeRunScoped.includes(tsFile)).toBe(true);

    expect(() => resolveTargetFiles({ taskId: "task-alpha" })).toThrow(HarnessError);
    expect(() => resolveTargetFiles({ runRoot: "  ", taskId: "task-alpha" })).toThrow(HarnessError);
    expect(() => resolveTargetFiles({ runRoot, taskId: "missing-task" })).toThrow(HarnessError);

    const commaFiles = resolveTargetFiles({
      fileFlags: [`${tsFile}, ${join(subDir, "nested.ts")}`],
    });
    expect(commaFiles.length).toBe(2);

    expect(readRunTasks(runRoot)["task-alpha"]).toBeDefined();
    expect(readRunTasks("/invalid/run/root")).toEqual({});
  });

  test("computeTaskCheckVerdict evaluates all combinations of check results", () => {
    const passTc = {
      passed: true,
      totalFiles: 1,
      totalErrors: 0,
      totalWarnings: 0,
      diagnostics: [],
    };
    const failTc = {
      passed: false,
      totalFiles: 1,
      totalErrors: 1,
      totalWarnings: 0,
      diagnostics: [],
    };
    const passLint = {
      passed: true,
      totalFiles: 1,
      totalViolations: 0,
      violations: [],
      summaryByRule: {},
    };
    const failLint = {
      passed: false,
      totalFiles: 1,
      totalViolations: 1,
      violations: [],
      summaryByRule: {},
    };

    expect(computeTaskCheckVerdict(undefined, undefined)).toBe(false);
    expect(computeTaskCheckVerdict(passTc, undefined)).toBe(true);
    expect(computeTaskCheckVerdict(failTc, undefined)).toBe(false);
    expect(computeTaskCheckVerdict(undefined, passLint)).toBe(true);
    expect(computeTaskCheckVerdict(undefined, failLint)).toBe(false);
    expect(computeTaskCheckVerdict(passTc, passLint)).toBe(true);
    expect(computeTaskCheckVerdict(passTc, failLint)).toBe(false);
    expect(computeTaskCheckVerdict(failTc, passLint)).toBe(false);
    expect(computeTaskCheckVerdict(failTc, failLint)).toBe(false);
  });

  test("formatTaskCheckMarkdown formats pass, fail, headings, tables, and truncation", () => {
    const diags: TypeCheckDiagnostic[] = Array.from({ length: 12 }, (_, i) => ({
      file: "src/sample.ts",
      line: i + 1,
      column: 1,
      code: 2322,
      message: `Type error ${i + 1} with | pipe symbol`,
      category: "error",
    }));

    const typeSummary: TaskCheckSummary = {
      passed: false,
      runRoot: "/virtual/run-root",
      taskId: "task-format",
      filesChecked: ["src/sample.ts"],
      durationMs: 45,
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

    const typeMd = formatTaskCheckMarkdown(typeSummary);
    expect(typeMd).toContain("Task `task-format`");
    expect(typeMd).toContain("FAIL: Verification Violations Detected");
    expect(typeMd).toContain("Capsule Run");
    expect(typeMd).toContain("additional type errors");

    const lintSummary: TaskCheckSummary = {
      passed: false,
      filesChecked: ["src/sample.ts"],
      durationMs: 25,
      format: "markdown",
      markdown: "",
      lint: {
        passed: false,
        totalFiles: 1,
        totalViolations: 12,
        violations: Array.from({ length: 12 }, (_, i) => ({
          rule: "any_type" as const,
          file: "src/sample.ts",
          line: i + 1,
          column: 5,
          snippet: "let x;",
          message: `Lint error ${i + 1} with | pipe`,
        })),
        summaryByRule: { any_type: 12 },
      },
    };

    const lintMd = formatTaskCheckMarkdown(lintSummary);
    expect(lintMd).toContain("additional invariant violations");

    const singleSummary: TaskCheckSummary = {
      passed: true,
      filesChecked: ["src/single.ts"],
      durationMs: 10,
      format: "markdown",
      markdown: "",
      typecheck: { passed: true, totalFiles: 1, totalErrors: 0, totalWarnings: 0, diagnostics: [] },
      lint: { passed: true, totalFiles: 1, totalViolations: 0, violations: [], summaryByRule: {} },
    };
    const singleMd = formatTaskCheckMarkdown(singleSummary);
    expect(singleMd).toContain("File `src/single.ts`");
    expect(singleMd).toContain("PASS");

    const multiSummary: TaskCheckSummary = {
      passed: true,
      filesChecked: ["src/1.ts", "src/2.ts", "src/3.ts"],
      durationMs: 15,
      format: "markdown",
      markdown: "",
    };
    const multiMd = formatTaskCheckMarkdown(multiSummary);
    expect(multiMd).toContain("3 Target Files");
  });

  test("taskCheckCommand handles arguments, formats, receipts, and exitCode", async () => {
    const root = await createVirtualDir("cmd-comprehensive-run");
    const runRoot = initRun(root, "cmd-test-run", new TextEncoder().encode("prompt"), "file", true);
    const sourcePath = join(root, "main.ts");
    await writeFile(sourcePath, "export const version = '1.0.0';\n");

    await expect(taskCheckCommand({})).rejects.toThrow("Must specify --file, --task");

    const emptyDir = await createVirtualDir("empty-source-dir");
    await writeFile(join(emptyDir, "image.png"), "not source code");
    await expect(taskCheckCommand({ file: emptyDir })).rejects.toThrow("No valid source files");

    const jsonRes = await taskCheckCommand({
      run: runRoot,
      file: sourcePath,
      format: "json",
      actor: "custom-tester",
    });
    expect(jsonRes.passed).toBe(true);
    expect(jsonRes.format).toBe("json");
    expect(jsonRes.evidence_path).toBeDefined();

    const lintOnlyRes = await taskCheckCommand({
      file: sourcePath,
      lint: true,
    });
    expect(lintOnlyRes.passed).toBe(true);
    expect(lintOnlyRes.typecheck).toBeUndefined();
    expect(lintOnlyRes.lint).toBeDefined();

    const bothRes = await taskCheckCommand({
      file: sourcePath,
      typecheck: true,
      lint: true,
    });
    expect(bothRes.passed).toBe(true);
    expect(bothRes.typecheck).toBeDefined();
    expect(bothRes.lint).toBeDefined();

    const origArgv1 = Bun.argv[1];
    try {
      (Bun.argv as string[])[1] = "/virtual/scripts/harness.ts";
      const harnessRes = await taskCheckCommand({ file: sourcePath, typecheck: true });
      expect(harnessRes.passed).toBe(true);
      expect(process.exitCode).toBe(0);
    } finally {
      (Bun.argv as string[])[1] = origArgv1;
    }
  });
});
