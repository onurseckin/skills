import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  computeTaskCheckVerdict,
  resolveTargetFiles,
  taskCheckCommand,
} from "../../../../../olt/scripts/src/cli/commands/task-check.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { setAutoReceiptDependenciesForTesting } from "../../../../../olt/scripts/src/engine/runner/receipt/auto-receipt.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
afterAll(async () => cleanupRoots(roots));

describe("task:check - Command Execution & Verifications", () => {
  test("resolveTargetFiles handles file flags, task scopes, and whole run", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-check-resolve-"));
    roots.push(root);

    const f1 = join(root, "f1.ts");
    const f2 = join(root, "f2.ts");
    await writeFile(f1, "export const f1 = 1;");
    await writeFile(f2, "export const f2 = 2;");

    const explicit = resolveTargetFiles({ fileFlags: [`${f1}, ${f2}`] });
    expect(explicit.length).toBe(2);

    const dirExplicit = resolveTargetFiles({ fileFlags: [root] });
    expect(dirExplicit.length).toBe(2);

    expect(() => resolveTargetFiles({ taskId: "task-01" })).toThrow("--run is required");

    const nonExistentFile = resolveTargetFiles({ fileFlags: [join(root, "not-here.ts")] });
    expect(nonExistentFile.length).toBe(1);
  });

  test("resolveTargetFiles resolves tasks, fallback store, and whole run from compiled run", async () => {
    const { repo, run } = await setupCompiledRun("task-check-resolve-run", roots);

    expect(() => resolveTargetFiles({ runRoot: run, taskId: "non-existent-task" })).toThrow(
      "unknown task",
    );

    await mkdir(join(repo, "tests/core"), { recursive: true });
    await writeFile(join(repo, "tests/core/file.ts"), "export const f = 1;\n");
    transact(run, "coordinator", "set-target-files", {}, (draft) => {
      const t = draft.tasks["task-core"]!;
      t.target_files = [join(repo, "custom-target.ts")];
      t.write_scope = [join(repo, "tests/core")];
    });

    const taskFiles = resolveTargetFiles({ runRoot: run, taskId: "task-core" });
    expect(taskFiles.length).toBeGreaterThan(0);

    transact(run, "coordinator", "corrupt-graph", {}, (draft) => {
      draft.graph = { revision: 0 };
    });
    const fallbackTaskFiles = resolveTargetFiles({ runRoot: run, taskId: "task-core" });
    expect(fallbackTaskFiles.length).toBeGreaterThan(0);

    const wholeRunFiles = resolveTargetFiles({ runRoot: run });
    expect(wholeRunFiles.length).toBeGreaterThan(0);

    const emptyRunFiles = resolveTargetFiles({ runRoot: "  " });
    expect(emptyRunFiles).toEqual([]);
  });

  test("taskCheckCommand runs full verification end to end with task and evidence", async () => {
    const { repo, run } = await setupCompiledRun("task-check-e2e-full", roots);

    await writeFile(
      join(repo, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
        },
      }),
    );

    const cleanPath = join(repo, "clean.ts");
    await writeFile(cleanPath, "export const cleanVal = 10;\n");

    const res = await taskCheckCommand({
      file: cleanPath,
    });
    expect(res.passed).toBe(true);
    expect(typeof res.markdown).toBe("string");

    const tcOnly = await taskCheckCommand({
      file: cleanPath,
      typecheck: true,
    });
    expect(tcOnly.typecheck).toBeDefined();
    expect(tcOnly.lint).toBeDefined();

    const lintOnly = await taskCheckCommand({
      file: cleanPath,
      lint: true,
    });
    expect(lintOnly.typecheck).toBeUndefined();
    expect(lintOnly.lint).toBeDefined();

    await mkdir(join(run, "evidence"), { recursive: true });

    const taskRes = await taskCheckCommand({
      run,
      file: cleanPath,
      lint: true,
      format: "json",
      actor: "test-actor",
    });
    expect(taskRes.passed).toBe(true);
    expect(taskRes.format).toBe("json");
    expect(taskRes.evidence_path).toBeDefined();

    const nonSourceDir = join(repo, "non-source-dir");
    await mkdir(nonSourceDir, { recursive: true });
    await writeFile(join(nonSourceDir, "image.png"), "fake image data");
    await expect(
      taskCheckCommand({
        file: nonSourceDir,
      }),
    ).rejects.toThrow(/No valid source files found/);

    await expect(taskCheckCommand({})).rejects.toThrow(
      "Must specify --file, --task (with --run), or --run",
    );

    const dispatched = await execute(["task:check", "--file", cleanPath]);
    expect(dispatched.passed).toBe(true);
  }, 30_000);

  test("explicit --run propagates mandatory receipt failures without recording an event", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "task-check-receipt-failure-"));
    roots.push(repositoryRoot);
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
