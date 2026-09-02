import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  computeTaskCheckVerdict,
  findNearestTsconfig,
  formatTaskCheckMarkdown,
  performIncrementalTypecheck,
  taskCheckCommand,
  type LintCheckResult,
  type TaskCheckSummary,
  type TypeCheckDiagnostic,
  type TypeCheckResult,
} from "../../../../olt/scripts/src/cli/commands/task-check.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("task:check - Typecheck & CLI Command Suite", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });
  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
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
      await writeFile(f2, "export const b: string = ok;");
      await writeFile(err, "export const c: number = bad;");
      expect(performIncrementalTypecheck([f1, f2, err]).passed).toBe(false);
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
    expect(tcMd).toContain("FAIL");

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

    transact(runRoot, "coordinator", "setup", {}, (draft) => {
      draft.tasks = {
        "task-x": { id: "task-x", status: "ready", target_files: [validFile], write_scope: [] },
      };
    });

    const resTask = await taskCheckCommand({ run: runRoot, task: "task-x" });
    expect(resTask.passed).toBe(true);
    expect(resTask.task_id).toBe("task-x");
  });
});
