import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectSourceFilesRecursively,
  computeTaskCheckVerdict,
  findNearestTsconfig,
  formatTaskCheckMarkdown,
  isSupportedSourceFile,
  performAstLintCheck,
  performIncrementalTypecheck,
  resolveTargetFiles,
  SUPPORTED_EXTENSIONS,
  taskCheckCommand,
  type LintCheckResult,
  type TaskCheckSummary,
  type TypeCheckResult,
} from "../../../../olt/scripts/src/cli/commands/task-check.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { ALL_AST_LINT_RULES } from "../../../../olt/scripts/src/linter/ast/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

let vfsCleanup: (() => void) | undefined;
let scratchCount = 0;

beforeEach(() => {
  const setup = setupWorkflowVirtualFs();
  vfsCleanup = setup.cleanup;
});

afterEach(() => {
  vfsCleanup?.();
  vfsCleanup = undefined;
});

function createScratchContext(label: string): {
  readonly rootDir: string;
  readonly repoDir: string;
} {
  const rootDir = `/virtual/tmp/task-check-diag-${label}-${++scratchCount}`;
  const repoDir = join(rootDir, "repo");
  mkdirSync(repoDir, { recursive: true });
  return { rootDir, repoDir };
}

function createCapsuleRun(
  label: string,
  tasks: Record<string, TaskRecord>,
): {
  readonly runRoot: string;
  readonly repoDir: string;
} {
  const { repoDir } = createScratchContext(label);
  const runRoot = initRun(
    repoDir,
    `task-check-${label}`,
    new TextEncoder().encode("prompt"),
    "file",
    true,
  );
  transact(runRoot, "test-actor", "seed-tasks", {}, (draft) => {
    draft.graph = { revision: 1, gates: [] };
    draft.requirements = { requirements: [] };
    draft.tasks = tasks;
  });
  return { runRoot, repoDir };
}
describe("task-check: performIncrementalTypecheck diagnostics", () => {
  test("returns failed status when TypeScript errors exist in targeted file", async () => {
    const { repoDir } = createScratchContext("cmd-type-fail");
    const errorFile = join(repoDir, "broken.ts");
    writeFileSync(errorFile, "export const num: number = 'not-a-number';\n");

    const flags: Flags = {
      file: errorFile,
    };

    const result = await taskCheckCommand(flags);
    expect(result.passed).toBe(false);
    const typecheck = result.typecheck as { passed: boolean; total_errors: number };
    expect(typecheck.passed).toBe(false);
    expect(typecheck.total_errors).toBeGreaterThanOrEqual(1);
    expect(String(result.markdown)).toContain("FAIL");
  });

  test("returns failed status when AST invariant violations exist in targeted file", async () => {
    const { repoDir } = createScratchContext("cmd-lint-fail");
    const errorFile = join(repoDir, "any-defect.ts");
    writeFileSync(errorFile, "export const item: any = 'test';\n");

    const flags: Flags = {
      file: errorFile,
    };

    const result = await taskCheckCommand(flags);
    expect(result.passed).toBe(false);
    const lint = result.lint as { passed: boolean; total_violations: number };
    expect(lint.passed).toBe(false);
    expect(lint.total_violations).toBeGreaterThanOrEqual(1);
    expect(String(result.markdown)).toContain("FAIL");
  });

  test("returns failed status when both type errors and AST violations exist", async () => {
    const { repoDir } = createScratchContext("cmd-both-fail");
    const brokenFile = join(repoDir, "double-defect.ts");
    writeFileSync(
      brokenFile,
      `export const a: any = 1;
export const b: number = "not-a-number";
`,
    );

    const flags: Flags = {
      file: brokenFile,
    };

    const result = await taskCheckCommand(flags);
    expect(result.passed).toBe(false);
    const typecheck = result.typecheck as { passed: boolean };
    const lint = result.lint as { passed: boolean };
    expect(typecheck.passed).toBe(false);
    expect(lint.passed).toBe(false);
  });

  test("supports --format json flag", async () => {
    const { repoDir } = createScratchContext("cmd-format-json");
    const validFile = join(repoDir, "json-test.ts");
    writeFileSync(validFile, "export const message: string = 'hello';\n");

    const flags: Flags = {
      file: validFile,
      format: "json",
    };

    const result = await taskCheckCommand(flags);
    expect(result.format).toBe("json");
    expect(result.passed).toBe(true);
  });

  test("integrates with capsule run and --task write scope verification", async () => {
    const { repoDir } = createScratchContext("cmd-task-scope");
    const targetFile = join(repoDir, "task-code.ts");
    writeFileSync(
      targetFile,
      `export interface TaskOutput {
  readonly ready: boolean;
}
export const output: TaskOutput = { ready: true };
`,
    );

    const taskRecord: TaskRecord = {
      id: "task-alpha",
      status: "ready",
      requirement_ids: [],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      write_scope: [targetFile],
      target_files: [targetFile],
    };

    const { runRoot } = createCapsuleRun("task-scope-run", {
      "task-alpha": taskRecord,
    });

    const flags: Flags = {
      run: runRoot,
      task: "task-alpha",
    };

    const result = await taskCheckCommand(flags);
    expect(result.passed).toBe(true);
    expect(result.run_root).toBe(runRoot);
    expect(result.task_id).toBe("task-alpha");
    expect((result.files_checked as string[]).includes(targetFile)).toBe(true);
    expect(String(result.markdown)).toContain("Task `task-alpha`");
  });

  test("integrates with capsule run verifying all tasks when only --run is provided", async () => {
    const { repoDir } = createScratchContext("cmd-whole-run");
    const file1 = join(repoDir, "mod1.ts");
    const file2 = join(repoDir, "mod2.ts");
    writeFileSync(file1, "export const val1: number = 10;\n");
    writeFileSync(file2, "export const val2: string = 'test';\n");

    const task1: TaskRecord = {
      id: "task-1",
      status: "ready",
      requirement_ids: [],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      write_scope: [file1],
    };
    const task2: TaskRecord = {
      id: "task-2",
      status: "ready",
      requirement_ids: [],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      write_scope: [file2],
    };

    const { runRoot } = createCapsuleRun("all-run-tasks", {
      "task-1": task1,
      "task-2": task2,
    });

    const flags: Flags = {
      run: runRoot,
    };

    const result = await taskCheckCommand(flags);
    expect(result.passed).toBe(true);
    expect(result.run_root).toBe(runRoot);
    expect((result.files_checked as string[]).includes(file1)).toBe(true);
    expect((result.files_checked as string[]).includes(file2)).toBe(true);
  });
});
