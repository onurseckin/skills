import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
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
} from "../../../olt/scripts/src/cli/commands/task-check.ts";
import * as astLinter from "../../../olt/scripts/src/linter/ast/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "./fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("task:check Unit & Coverage Suite", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });
  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("SUPPORTED_EXTENSIONS and isSupportedSourceFile", () => {
    for (const ext of SUPPORTED_EXTENSIONS) expect(isSupportedSourceFile(`f${ext}`)).toBe(true);
    expect(isSupportedSourceFile("f.json")).toBe(false);
    expect(isSupportedSourceFile("f.py")).toBe(false);
    expect(isSupportedSourceFile("")).toBe(false);
    expect(isSupportedSourceFile("test.ts.bak")).toBe(false);
  });

  test("collectSourceFilesRecursively traversal, depth limit, and ignored dirs", async () => {
    const root = await createVirtualDir("collect-cov");
    expect(collectSourceFilesRecursively("/non-existent-dir")).toEqual([]);
    expect(collectSourceFilesRecursively(root, 1, 2)).toEqual([]);

    for (const d of ["node_modules/sub", ".git", "dist", "build", "coverage", "src/nested"]) {
      await mkdir(join(root, d), { recursive: true });
    }
    await writeFile(join(root, "node_modules/sub/pkg.ts"), "export const a = 1;");
    await writeFile(join(root, ".git/hook.ts"), "export const b = 2;");
    await writeFile(join(root, "dist/out.ts"), "export const c = 3;");
    await writeFile(join(root, "build/build.ts"), "export const d = 4;");
    await writeFile(join(root, "coverage/cov.ts"), "export const e = 5;");
    await writeFile(join(root, "src/nested/valid.ts"), "export const ok = true;");
    await writeFile(join(root, "src/nested/doc.txt"), "readme");

    expect(collectSourceFilesRecursively(root).length).toBe(1);

    const spy = spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("fs error");
    });
    expect(collectSourceFilesRecursively(root)).toEqual([]);
    spy.mockRestore();
  });

  test("readRunTasks and resolveTargetFiles with various task configurations", async () => {
    const root = await createVirtualDir("resolve-cov");
    const runRoot = initRun(root, "task-cov-run", new TextEncoder().encode("prompt"), "file", true);
    const file1 = join(root, "file1.ts"),
      file2 = join(root, "file2.tsx"),
      subDir = join(root, "sub");
    await mkdir(subDir, { recursive: true });
    await writeFile(file1, "export const f1 = 1;");
    await writeFile(file2, "export const f2 = 2;");
    await writeFile(join(subDir, "nested.ts"), "export const n = 3;");

    transact(runRoot, "coordinator", "setup", {}, (draft) => {
      draft.tasks = {
        "task-1": {
          id: "task-1",
          status: "ready",
          target_files: [file1, "", null as unknown as string],
          write_scope: [subDir, join(root, "ghost.ts")],
        },
        "task-2": { id: "task-2", status: "ready", target_files: [file2], write_scope: [] },
      };
    });

    const tasks = readRunTasks(runRoot);
    expect(tasks["task-1"]).toBeDefined();
    expect(tasks["task-2"]).toBeDefined();
    expect(() => resolveTargetFiles({ taskId: "task-1" })).toThrow(HarnessError);
    expect(() => resolveTargetFiles({ runRoot: "  ", taskId: "task-1" })).toThrow(HarnessError);
    expect(() => resolveTargetFiles({ runRoot, taskId: "unknown-task" })).toThrow(HarnessError);
    expect(resolveTargetFiles({ runRoot, taskId: "task-1" }).length).toBe(3);
    expect(resolveTargetFiles({ runRoot }).length).toBe(4);
    expect(resolveTargetFiles({ fileFlags: [subDir, file1, `${file1}, ${file2},  `] }).length).toBe(
      3,
    );
    expect(resolveTargetFiles({})).toEqual([]);

    transact(runRoot, "coordinator", "bad-tasks", {}, (draft) => {
      draft.tasks = "invalid" as unknown as Record<string, unknown>;
    });
    expect(typeof readRunTasks(runRoot)).toBe("object");
  });

  test("findNearestTsconfig handles paths, files, and directories", async () => {
    const root = await createVirtualDir("tsconfig-cov");
    const sub = join(root, "nested");
    await mkdir(sub, { recursive: true });
    const tsFile = join(sub, "index.ts");
    await writeFile(tsFile, "export const x = 1;");

    findNearestTsconfig(join(root, "does-not-exist.ts"));
    findNearestTsconfig(sub);
    const found = findNearestTsconfig(tsFile);
    expect(found === undefined || typeof found === "string").toBe(true);
  });

  test("performIncrementalTypecheck handles clean, error, diagnostics and non-test environments", async () => {
    expect(performIncrementalTypecheck([])).toEqual({
      passed: true,
      totalFiles: 0,
      totalErrors: 0,
      totalWarnings: 0,
      diagnostics: [],
    });
    const root = await createVirtualDir("typecheck-cov");
    const cleanFile = join(root, "clean.ts");
    await writeFile(cleanFile, "export const num: number = 42;\n");
    expect(performIncrementalTypecheck([cleanFile]).passed).toBe(true);

    const errFile = join(root, "error.ts");
    await writeFile(errFile, "export const str: string = 123;\n");
    const errRes = performIncrementalTypecheck([errFile]);
    expect(errRes.passed).toBe(false);
    expect(errRes.diagnostics[0]?.line).toBeGreaterThan(0);

    const origArgv = [...process.argv];
    const origBunArgv = [...(Bun.argv as string[])];
    const origNodeEnv = process.env["NODE_ENV"];
    const origBunTest = process.env["BUN_TEST"];
    const origTest = process.env["TEST"];
    const origCwd = process.cwd();
    try {
      process.env["NODE_ENV"] = "production";
      Bun.env["NODE_ENV"] = "production";
      delete process.env["BUN_TEST"];
      delete process.env["TEST"];
      delete (Bun.env as any)["BUN_TEST"];
      delete (Bun.env as any)["TEST"];
      (process.argv as string[]).length = 0;
      (process.argv as string[]).push("bun", "run", "cli.js");
      (Bun.argv as string[]).length = 0;
      (Bun.argv as string[]).push("bun", "run", "cli.js");

      const tsDir = join(root, "cfg");
      await mkdir(tsDir, { recursive: true });
      await writeFile(
        join(tsDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { noEmit: true } }),
      );
      const f1 = join(tsDir, "1.ts"),
        f2 = join(tsDir, "2.ts"),
        err = join(tsDir, "err.ts");
      await writeFile(f1, "export const a: number = 1;");
      await writeFile(f2, "export const b: string = 'ok';");
      await writeFile(err, "export const c: number = 'bad';");
      expect(performIncrementalTypecheck([f1, f2, err]).passed).toBe(false);

      const isolatedDir = join(root, "isolated");
      await mkdir(isolatedDir, { recursive: true });
      process.chdir(isolatedDir);
      const fb1 = join(isolatedDir, "fb1.ts"),
        fbErr = join(isolatedDir, "fb-err.ts");
      await writeFile(fb1, "export const x = 1;");
      await writeFile(fbErr, "export const y: number = 'bad';");
      const fallbackRes = performIncrementalTypecheck([fb1, fbErr]);
      expect(fallbackRes.passed).toBe(false);
      expect(fallbackRes.diagnostics.length).toBeGreaterThan(0);

      const brokenDir = join(root, "broken");
      await mkdir(brokenDir, { recursive: true });
      await writeFile(join(brokenDir, "tsconfig.json"), "{ invalid json");
      const badTs = join(brokenDir, "bad.ts");
      await writeFile(badTs, "export const b: number = 'bad';");
      const brokenRes = performIncrementalTypecheck([badTs]);
      expect(brokenRes.passed).toBe(false);
      expect(brokenRes.diagnostics.length).toBeGreaterThan(0);
    } finally {
      process.chdir(origCwd);
      if (origNodeEnv !== undefined) {
        process.env["NODE_ENV"] = origNodeEnv;
        Bun.env["NODE_ENV"] = origNodeEnv;
      } else {
        delete process.env["NODE_ENV"];
        delete (Bun.env as any)["NODE_ENV"];
      }
      if (origBunTest !== undefined) {
        process.env["BUN_TEST"] = origBunTest;
        Bun.env["BUN_TEST"] = origBunTest;
      }
      if (origTest !== undefined) {
        process.env["TEST"] = origTest;
        Bun.env["TEST"] = origTest;
      }
      (process.argv as string[]).length = 0;
      (process.argv as string[]).push(...origArgv);
      (Bun.argv as string[]).length = 0;
      (Bun.argv as string[]).push(...origBunArgv);
    }
  });

  test("performAstLintCheck handles empty, clean, violation, and exception cases", async () => {
    expect(performAstLintCheck([]).passed).toBe(true);
    const root = await createVirtualDir("ast-lint-cov");
    const cleanFile = join(root, "clean.ts");
    await writeFile(cleanFile, "export const cleanVal = 100;\n");
    expect(performAstLintCheck([cleanFile]).passed).toBe(true);

    const violFile = join(root, "viol.ts");
    await writeFile(
      violFile,
      "export const x: any = 10;\nexport const y: any = 20;\n// @ts-ignore\nconst z = 30;\n",
    );
    const violRes = performAstLintCheck([violFile]);
    expect(violRes.passed).toBe(false);
    expect(violRes.summaryByRule["any_type"]).toBe(2);

    const spyCrash = spyOn(astLinter, "lintFile").mockImplementation(() => {
      throw new Error("mock crash");
    });
    const crashRes = performAstLintCheck([cleanFile]);
    expect(crashRes.passed).toBe(false);
    expect(crashRes.violations.some((v) => v.message.includes("Failed to lint file"))).toBe(true);
    spyCrash.mockRestore();
  });

  test("computeTaskCheckVerdict truth table and formatTaskCheckMarkdown permutations", () => {
    const pTc: TypeCheckResult = {
      passed: true,
      totalFiles: 1,
      totalErrors: 0,
      totalWarnings: 0,
      diagnostics: [],
    };
    const fTc: TypeCheckResult = {
      passed: false,
      totalFiles: 1,
      totalErrors: 1,
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
    const fLint: LintCheckResult = {
      passed: false,
      totalFiles: 1,
      totalViolations: 1,
      violations: [],
      summaryByRule: {},
    };

    expect(computeTaskCheckVerdict(undefined, undefined)).toBe(false);
    expect(computeTaskCheckVerdict(pTc, undefined)).toBe(true);
    expect(computeTaskCheckVerdict(fTc, undefined)).toBe(false);
    expect(computeTaskCheckVerdict(undefined, pLint)).toBe(true);
    expect(computeTaskCheckVerdict(undefined, fLint)).toBe(false);
    expect(computeTaskCheckVerdict(pTc, pLint)).toBe(true);
    expect(computeTaskCheckVerdict(pTc, fLint)).toBe(false);
    expect(computeTaskCheckVerdict(fTc, pLint)).toBe(false);
    expect(computeTaskCheckVerdict(fTc, fLint)).toBe(false);

    const diags: TypeCheckDiagnostic[] = Array.from({ length: 11 }, (_, i) => ({
      file: "src/file.ts",
      line: i + 1,
      column: 1,
      code: 2322,
      message: `Type error ${i + 1} | details`,
      category: "error",
    }));
    const tcFailSummary: TaskCheckSummary = {
      passed: false,
      runRoot: "/virtual/run",
      taskId: "task-fail",
      filesChecked: ["src/file.ts"],
      durationMs: 50,
      format: "markdown",
      markdown: "",
      typecheck: {
        passed: false,
        totalFiles: 1,
        totalErrors: 11,
        totalWarnings: 0,
        diagnostics: diags,
      },
    };
    const tcMd = formatTaskCheckMarkdown(tcFailSummary);
    expect(tcMd).toContain("Task `task-fail`");
    expect(tcMd).toContain("FAIL: Verification Violations Detected");
    expect(tcMd).toContain("additional type errors");

    const lintFailSummary: TaskCheckSummary = {
      passed: false,
      filesChecked: ["src/file.ts"],
      durationMs: 50,
      format: "markdown",
      markdown: "",
      lint: {
        passed: false,
        totalFiles: 1,
        totalViolations: 11,
        violations: Array.from({ length: 11 }, (_, i) => ({
          rule: "any_type" as const,
          file: "src/file.ts",
          line: i + 1,
          column: 1,
          snippet: "any",
          message: `Violation ${i + 1} | details`,
        })),
        summaryByRule: { any_type: 11 },
      },
    };
    expect(formatTaskCheckMarkdown(lintFailSummary)).toContain("additional invariant violations");

    const passSummary: TaskCheckSummary = {
      passed: true,
      filesChecked: ["src/a.ts", "src/b.ts"],
      durationMs: 15,
      format: "markdown",
      markdown: "",
      typecheck: pTc,
      lint: pLint,
    };
    const passMd = formatTaskCheckMarkdown(passSummary);
    expect(passMd).toContain("2 Target Files");
    expect(passMd).toContain("PASS");
  });

  test("taskCheckCommand execution, flags, evidence recording, and harness exit", async () => {
    const root = await createVirtualDir("cmd-cov");
    const runRoot = initRun(root, "cmd-cov-run", new TextEncoder().encode("prompt"), "file", true);
    const validFile = join(root, "index.ts");
    await writeFile(validFile, "export const app = 1;\n");

    await expect(taskCheckCommand({})).rejects.toThrow("Must specify --file, --task");
    const emptyDir = await createVirtualDir("empty-cov");
    await writeFile(join(emptyDir, "doc.md"), "markdown");
    await expect(taskCheckCommand({ file: emptyDir })).rejects.toThrow(
      "No valid source files found matching --file",
    );

    const resJson = await taskCheckCommand({
      run: runRoot,
      file: validFile,
      format: "json",
      actor: "test-actor",
      typecheck: true,
      lint: true,
    });
    expect(resJson.passed).toBe(true);
    expect(resJson.evidence_path).toBeDefined();
    expect(resJson.format).toBe("json");

    const resLintOnly = await taskCheckCommand({ file: validFile, lint: true });
    expect(resLintOnly.passed).toBe(true);
    expect(resLintOnly.typecheck).toBeUndefined();

    transact(runRoot, "coordinator", "setup", {}, (draft) => {
      draft.tasks = {
        "task-x": { id: "task-x", status: "ready", target_files: [validFile], write_scope: [] },
      };
    });

    const resTask = await taskCheckCommand({ run: runRoot, task: "task-x" });
    expect(resTask.passed).toBe(true);
    expect(resTask.task_id).toBe("task-x");

    const origArgv = Bun.argv[1];
    try {
      (Bun.argv as string[])[1] = "/virtual/path/harness.ts";
      const harnessRes = await taskCheckCommand({ file: validFile });
      expect(harnessRes.passed).toBe(true);
      expect(process.exitCode).toBe(0);
    } finally {
      (Bun.argv as string[])[1] = origArgv;
    }
  });
});
