import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  collectSourceFilesRecursively,
  computeTaskCheckVerdict,
  findNearestTsconfig,
  performAstLintCheck,
  performIncrementalTypecheck,
  readRunTasks,
  resolveTargetFiles,
  taskCheckCommand,
} from "../../../../../olt/scripts/src/cli/commands/task-check.ts";
import * as coreModule from "../../../../../olt/scripts/src/core/index.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { setAutoReceiptDependenciesForTesting } from "../../../../../olt/scripts/src/engine/runner/receipt/auto-receipt.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import * as astLinterModule from "../../../../../olt/scripts/src/linter/ast/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];

async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("task:check - Command Execution & Verifications", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("resolveTargetFiles, readRunTasks, and collectSourceFilesRecursively handle scopes and fallbacks", async () => {
    const { repo, run } = await setupCompiledRun("task-check-resolve-run", roots);
    const f1 = join(repo, "f1.ts");
    const f2 = join(repo, "f2.ts");
    await writeFile(f1, "export const f1 = 1;");
    await writeFile(f2, "export const f2 = 2;");

    expect(
      resolveTargetFiles({ fileFlags: [`${f1}, ${f2}`, join(repo, "missing.ts")] }).length,
    ).toBe(3);
    expect(resolveTargetFiles({ fileFlags: [repo] }).length).toBeGreaterThan(0);
    expect(() => resolveTargetFiles({ taskId: "task-01" })).toThrow("--run is required");
    expect(() => resolveTargetFiles({ runRoot: run, taskId: "non-existent-task" })).toThrow(
      "unknown task",
    );

    await mkdir(join(repo, "tests/core"), { recursive: true });
    await writeFile(join(repo, "tests/core/file.ts"), "export const f = 1;\n");
    transact(run, "coordinator", "set-target-files", {}, (draft) => {
      const tasks = draft.tasks as Record<
        string,
        { target_files?: string[]; write_scope?: string[] } | undefined
      >;
      const t = tasks["task-core"];
      if (t) {
        t.target_files = [join(repo, "custom-target.ts")];
        t.write_scope = [join(repo, "tests/core")];
      }
    });

    expect(resolveTargetFiles({ runRoot: run, taskId: "task-core" }).length).toBeGreaterThan(0);
    transact(run, "coordinator", "corrupt-graph", {}, (draft) => {
      draft.graph = { revision: 0 };
    });
    expect(resolveTargetFiles({ runRoot: run, taskId: "task-core" }).length).toBeGreaterThan(0);
    expect(resolveTargetFiles({ runRoot: run }).length).toBeGreaterThan(0);
    expect(resolveTargetFiles({ runRoot: "   " })).toEqual([]);

    expect(Object.keys(readRunTasks(run)).length).toBeGreaterThan(0);
    expect(readRunTasks("/non-existent-run")).toEqual({});
    expect(collectSourceFilesRecursively("/non-existent-path")).toEqual([]);
  });

  test("taskCheckCommand executes end-to-end with evidence, exit codes, and flag modes", async () => {
    const { repo, run } = await setupCompiledRun("task-check-e2e-full", roots);
    const cleanPath = join(repo, "clean.ts");
    await writeFile(cleanPath, "export const cleanVal = 10;\n");

    const origArgv1 = Bun.argv[1];
    (Bun.argv as string[])[1] = "/virtual/bin/harness.ts";

    const res = await taskCheckCommand({ run, file: cleanPath, typecheck: true, format: "json" });
    expect(res.passed).toBe(true);
    expect(res.evidence_path).toBeDefined();
    expect(process.exitCode).toBe(0);

    const lintOnly = await taskCheckCommand({ file: cleanPath, lint: true });
    expect(lintOnly.typecheck).toBeUndefined();
    expect(lintOnly.lint).toBeDefined();

    (Bun.argv as string[])[1] = origArgv1;

    const nonSourceDir = join(repo, "non-source-dir");
    await mkdir(nonSourceDir, { recursive: true });
    await writeFile(join(nonSourceDir, "image.png"), "fake image data");
    await expect(taskCheckCommand({ file: nonSourceDir })).rejects.toThrow(
      /No valid source files found/,
    );
    await expect(taskCheckCommand({})).rejects.toThrow(
      "Must specify --file, --task (with --run), or --run",
    );

    const dispatched = await execute(["task:check", "--file", cleanPath]);
    expect(dispatched.passed).toBe(true);
  }, 30_000);

  test("explicit --run propagates mandatory receipt failures without recording an event", async () => {
    const repositoryRoot = await createVirtualDir("task-check-receipt-failure");
    const runRoot = initRun(
      repositoryRoot,
      "receipt-failure-run",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );
    const sourceFile = join(repositoryRoot, "clean.ts");
    await writeFile(sourceFile, "export const cleanValue = 1;\n");
    const eventsPath = join(runRoot, "events.jsonl");
    const eventsBefore = await readFile(eventsPath, "utf-8");
    const restoreDependencies = setAutoReceiptDependenciesForTesting({
      transact: () => {
        throw new HarnessError("LOCK_TIMEOUT", "forced receipt transaction failure");
      },
    });

    try {
      await expect(
        taskCheckCommand({
          run: runRoot,
          file: sourceFile,
          lint: true,
          actor: "task-check-receipt-test",
        }),
      ).rejects.toThrow("forced receipt transaction failure");
    } finally {
      restoreDependencies();
    }
    expect(await readFile(eventsPath, "utf-8")).toBe(eventsBefore);
  });

  test("incremental typecheck and ast lint handle empty inputs, config groups, fallback mode, and errors", async () => {
    const root = await createVirtualDir("task-check-branches");
    const validTs = join(root, "valid.ts");
    const tsconfigPath = join(root, "tsconfig.json");
    await writeFile(validTs, "export const num: number = 42;\n");
    await writeFile(
      tsconfigPath,
      JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext" } }),
    );

    expect(performIncrementalTypecheck([]).passed).toBe(true);
    expect(performAstLintCheck([]).passed).toBe(true);
    expect(findNearestTsconfig(root)).toBe(tsconfigPath);
    expect(findNearestTsconfig(join(root, "non-existent.ts"))).toBe(tsconfigPath);

    const envSpy = spyOn(coreModule, "isTestEnvironment").mockReturnValue(false);
    try {
      const v2 = join(root, "valid2.ts");
      await writeFile(v2, "export const num2: number = 100;\n");
      const badGroupTs = join(root, "type-err.ts");
      await writeFile(badGroupTs, "export const badNum: number = 'string-err';\n");

      const liveRes = performIncrementalTypecheck([validTs, v2, badGroupTs]);
      expect(liveRes.passed).toBe(false);
      expect(liveRes.totalErrors).toBeGreaterThan(0);

      const isolatedDir = await createVirtualDir("isolated-no-tsconfig");
      const badFallbackTs = join(isolatedDir, "fallback-err.ts");
      await writeFile(badFallbackTs, "export const fbErr: number = 'fallback-string';\n");
      const fbRes = performIncrementalTypecheck([badFallbackTs]);
      expect(fbRes.passed).toBe(false);
    } finally {
      envSpy.mockRestore();
    }

    const lintSpy = spyOn(astLinterModule, "lintFile").mockImplementation(() => {
      throw new Error("Linter crash");
    });
    try {
      const lintRes = performAstLintCheck([validTs]);
      expect(lintRes.passed).toBe(false);
      expect(lintRes.violations.some((v) => v.message.includes("Linter crash"))).toBe(true);
    } finally {
      lintSpy.mockRestore();
    }
  });

  test("computeTaskCheckVerdict evaluates combinations accurately", () => {
    expect(computeTaskCheckVerdict(undefined, undefined)).toBe(false);
    expect(
      computeTaskCheckVerdict(
        { passed: true, totalFiles: 1, totalErrors: 0, totalWarnings: 0, diagnostics: [] },
        undefined,
      ),
    ).toBe(true);
    expect(
      computeTaskCheckVerdict(undefined, {
        passed: true,
        totalFiles: 1,
        totalViolations: 0,
        violations: [],
        summaryByRule: {},
      }),
    ).toBe(true);
    expect(
      computeTaskCheckVerdict(
        { passed: false, totalFiles: 1, totalErrors: 1, totalWarnings: 0, diagnostics: [] },
        { passed: true, totalFiles: 1, totalViolations: 0, violations: [], summaryByRule: {} },
      ),
    ).toBe(false);
    expect(
      computeTaskCheckVerdict(
        { passed: true, totalFiles: 1, totalErrors: 0, totalWarnings: 0, diagnostics: [] },
        { passed: false, totalFiles: 1, totalViolations: 1, violations: [], summaryByRule: {} },
      ),
    ).toBe(false);
  });
});
