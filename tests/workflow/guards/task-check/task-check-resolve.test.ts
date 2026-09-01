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
  const rootDir = `/virtual/tmp/task-check-res-${label}-${++scratchCount}`;
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
describe("task-check: resolveTargetFiles", () => {
  test("resolves explicit file flags with single and comma-separated entries", () => {
    const { repoDir } = createScratchContext("resolve-file-flags");
    const fileA = join(repoDir, "a.ts");
    const fileB = join(repoDir, "b.ts");
    const fileC = join(repoDir, "c.ts");

    writeFileSync(fileA, "export const a = 1;");
    writeFileSync(fileB, "export const b = 2;");
    writeFileSync(fileC, "export const c = 3;");

    const resolved = resolveTargetFiles({
      fileFlags: [fileA, `${fileB}, ${fileC}`],
    });

    expect(resolved.length).toBe(3);
    expect(resolved.includes(fileA)).toBe(true);
    expect(resolved.includes(fileB)).toBe(true);
    expect(resolved.includes(fileC)).toBe(true);
  });

  test("recursively expands directories passed in file flags", () => {
    const { repoDir } = createScratchContext("resolve-dir-flags");
    const srcDir = join(repoDir, "src");
    mkdirSync(srcDir, { recursive: true });

    const file1 = join(srcDir, "one.ts");
    const file2 = join(srcDir, "two.ts");
    writeFileSync(file1, "export const one = 1;");
    writeFileSync(file2, "export const two = 2;");

    const resolved = resolveTargetFiles({
      fileFlags: [srcDir],
    });

    expect(resolved.length).toBe(2);
    expect(resolved.includes(file1)).toBe(true);
    expect(resolved.includes(file2)).toBe(true);
  });

  test("throws HarnessError when taskId is specified without runRoot", () => {
    expect(() => {
      resolveTargetFiles({
        taskId: "task-1",
      });
    }).toThrow(new HarnessError("INVALID_ARGUMENT", "--run is required when --task is specified"));
  });

  test("throws HarnessError when taskId is not found in runRoot", () => {
    const { runRoot } = createCapsuleRun("unknown-task", {});
    expect(() => {
      resolveTargetFiles({
        runRoot,
        taskId: "non-existent-task",
      });
    }).toThrow(new HarnessError("INVALID_ARGUMENT", "unknown task non-existent-task"));
  });

  test("resolves task target_files and write_scope from capsule run including non-existent source candidates", () => {
    const { repoDir } = createScratchContext("task-scope-resolve");
    const file1 = join(repoDir, "target.ts");
    const file2 = join(repoDir, "scoped.ts");
    const uncreatedCandidate = join(repoDir, "future-feature.ts");
    writeFileSync(file1, "export const t = 1;");
    writeFileSync(file2, "export const s = 2;");

    const taskRecord: TaskRecord = {
      id: "task-1",
      status: "ready",
      requirement_ids: [],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      write_scope: [file2, uncreatedCandidate],
      target_files: [file1],
    };

    const { runRoot } = createCapsuleRun("task-scope", {
      "task-1": taskRecord,
    });

    const resolved = resolveTargetFiles({
      runRoot,
      taskId: "task-1",
    });

    expect(resolved.length).toBe(3);
    expect(resolved.includes(file1)).toBe(true);
    expect(resolved.includes(file2)).toBe(true);
    expect(resolved.includes(uncreatedCandidate)).toBe(true);
  });

  test("resolves write_scope across all tasks when only runRoot is provided", () => {
    const { repoDir } = createScratchContext("run-scope-all");
    const fileA = join(repoDir, "a.ts");
    const fileB = join(repoDir, "b.ts");
    writeFileSync(fileA, "export const a = 1;");
    writeFileSync(fileB, "export const b = 2;");

    const task1: TaskRecord = {
      id: "task-1",
      status: "ready",
      requirement_ids: [],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      write_scope: [fileA],
    };
    const task2: TaskRecord = {
      id: "task-2",
      status: "ready",
      requirement_ids: [],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      write_scope: [fileB],
    };

    const { runRoot } = createCapsuleRun("all-tasks", {
      "task-1": task1,
      "task-2": task2,
    });

    const resolved = resolveTargetFiles({
      runRoot,
    });

    expect(resolved.length).toBe(2);
    expect(resolved.includes(fileA)).toBe(true);
    expect(resolved.includes(fileB)).toBe(true);
  });

  test("returns empty array when no files, task, or run scope are matched", () => {
    const resolved = resolveTargetFiles({});
    expect(resolved).toEqual([]);
  });
});
