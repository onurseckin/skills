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
  const rootDir = `/virtual/tmp/task-check-tc-${label}-${++scratchCount}`;
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

describe("task-check: taskCheckCommand CLI handler and flag matrix", () => {
  test("throws INVALID_ARGUMENT error when no target scope flags are provided", async () => {
    const flags: Flags = {};
    await expect(taskCheckCommand(flags)).rejects.toThrow(
      new HarnessError(
        "INVALID_ARGUMENT",
        "Must specify --file, --task (with --run), or --run for task:check verification",
      ),
    );
  });

  test("throws INVALID_ARGUMENT error when --file flag references an empty directory with no source files", async () => {
    const { repoDir } = createScratchContext("cmd-empty-dir");
    const emptySubdir = join(repoDir, "empty-dir");
    mkdirSync(emptySubdir, { recursive: true });

    const flags: Flags = {
      file: emptySubdir,
    };
    await expect(taskCheckCommand(flags)).rejects.toThrow(
      /No valid source files found matching --file arguments/,
    );
  });

  test("successfully executes both typecheck and lint by default on valid file", async () => {
    const { repoDir } = createScratchContext("cmd-default-pass");
    const validFile = join(repoDir, "service.ts");
    writeFileSync(
      validFile,
      `export interface ServiceConfig {
  readonly port: number;
  readonly host: string;
}
export function createConfig(): ServiceConfig {
  return { port: 8080, host: "localhost" };
}
`,
    );

    const flags: Flags = {
      file: validFile,
    };

    const result = await taskCheckCommand(flags);
    expect(result.passed).toBe(true);
    expect(result.files_checked).toEqual([validFile]);
    expect(result.format).toBe("markdown");
    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("PASS");

    const typecheck = result.typecheck as { passed: boolean; total_errors: number };
    const lint = result.lint as { passed: boolean; total_violations: number };
    expect(typecheck.passed).toBe(true);
    expect(typecheck.total_errors).toBe(0);
    expect(lint.passed).toBe(true);
    expect(lint.total_violations).toBe(0);
  });

  test("--typecheck adds the typecheck to the always-on AST lint audit, never replaces it", async () => {
    const { repoDir } = createScratchContext("cmd-typecheck-only");
    const tsFile = join(repoDir, "typecheck-only.ts");
    // Contains an AST lint violation (any) but valid TypeScript, so only the lint half should fail.
    writeFileSync(tsFile, "export const data: any = 100;\n");

    const flags: Flags = {
      file: tsFile,
      typecheck: true,
    };

    const result = await taskCheckCommand(flags);
    expect(result.typecheck).toBeDefined();
    // The always-on AST audit must still run and catch the violation `--typecheck` used to hide.
    expect(result.lint).toBeDefined();
    const lint = result.lint as { passed: boolean; total_violations: number };
    expect(lint.passed).toBe(false);
    expect(lint.total_violations).toBeGreaterThanOrEqual(1);
    // A check that ran and failed must never be outvoted into an overall PASS.
    expect(result.passed).toBe(false);
    expect(String(result.markdown)).toContain("FAIL");
  });

  test("executes only lint when --lint is true and --typecheck is omitted", async () => {
    const { repoDir } = createScratchContext("cmd-lint-only");
    const tsFile = join(repoDir, "lint-only.ts");
    // Contains a clean file
    writeFileSync(tsFile, "export const value: number = 42;\n");

    const flags: Flags = {
      file: tsFile,
      lint: true,
    };

    const result = await taskCheckCommand(flags);
    expect(result.passed).toBe(true);
    expect(result.lint).toBeDefined();
    expect(result.typecheck).toBeUndefined();
  });

  test("executes both typecheck and lint when both flags are explicitly true", async () => {
    const { repoDir } = createScratchContext("cmd-both-explicit");
    const tsFile = join(repoDir, "both.ts");
    writeFileSync(tsFile, "export const count: number = 10;\n");

    const flags: Flags = {
      file: tsFile,
      typecheck: true,
      lint: true,
    };

    const result = await taskCheckCommand(flags);
    expect(result.passed).toBe(true);
    expect(result.typecheck).toBeDefined();
    expect(result.lint).toBeDefined();
  });

  test("supports multiple files passed via array in file flag", async () => {
    const { repoDir } = createScratchContext("cmd-multi-file-flags");
    const file1 = join(repoDir, "f1.ts");
    const file2 = join(repoDir, "f2.ts");
    writeFileSync(file1, "export const a: number = 1;\n");
    writeFileSync(file2, "export const b: number = 2;\n");

    const flags: Flags = {
      file: [file1, file2],
    };

    const result = await taskCheckCommand(flags);
    expect(result.passed).toBe(true);
    expect((result.files_checked as string[]).length).toBe(2);
  });
});
