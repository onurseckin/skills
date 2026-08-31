import { describe, expect, test } from "bun:test";
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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

function createScratchContext(label: string): {
  readonly rootDir: string;
  readonly repoDir: string;
} {
  const rootDir = mkdtempSync(join(tmpdir(), `task-check-${label}-`));
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

describe("task-check: computeTaskCheckVerdict", () => {
  const failingTypecheck: TypeCheckResult = {
    passed: false,
    totalFiles: 1,
    totalErrors: 1,
    totalWarnings: 0,
    diagnostics: [],
  };
  const passingTypecheck: TypeCheckResult = {
    passed: true,
    totalFiles: 1,
    totalErrors: 0,
    totalWarnings: 0,
    diagnostics: [],
  };
  const failingLint: LintCheckResult = {
    passed: false,
    totalFiles: 1,
    totalViolations: 1,
    violations: [],
    summaryByRule: {},
  };
  const passingLint: LintCheckResult = {
    passed: true,
    totalFiles: 1,
    totalViolations: 0,
    violations: [],
    summaryByRule: {},
  };

  test("both checks passing yields an overall pass", () => {
    expect(computeTaskCheckVerdict(passingTypecheck, passingLint)).toBe(true);
  });

  test("a failing typecheck fails the verdict even when lint passed", () => {
    expect(computeTaskCheckVerdict(failingTypecheck, passingLint)).toBe(false);
  });

  test("a failing lint fails the verdict even when typecheck passed", () => {
    expect(computeTaskCheckVerdict(passingTypecheck, failingLint)).toBe(false);
  });

  test("a skipped typecheck does not count against a passing lint", () => {
    expect(computeTaskCheckVerdict(undefined, passingLint)).toBe(true);
  });

  test("neither check having run does not read as a pass", () => {
    expect(computeTaskCheckVerdict(undefined, undefined)).toBe(false);
  });
});

describe("task-check: real CLI subprocess exit code", () => {
  const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
  const entrypoint = join(repoRoot, "olt", "scripts", "harness.ts");

  async function spawnTaskCheck(args: readonly string[]): Promise<{
    readonly exitCode: number;
    readonly stdout: string;
  }> {
    const proc = Bun.spawn(["bun", entrypoint, "task:check", ...args], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { exitCode, stdout };
  }

  test("exits non-zero when the always-on AST lint audit reports violations", async () => {
    const { repoDir } = createScratchContext("spawn-lint-fail");
    const violatingFile = join(repoDir, "violation.ts");
    writeFileSync(violatingFile, "export const leaked: any = 1;\n");

    const { exitCode, stdout } = await spawnTaskCheck(["--file", violatingFile]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("FAIL");
  });

  test("exits zero on a genuinely clean file", async () => {
    const { repoDir } = createScratchContext("spawn-clean-pass");
    const cleanFile = join(repoDir, "clean.ts");
    writeFileSync(cleanFile, "export const value: number = 1;\n");

    const { exitCode, stdout } = await spawnTaskCheck(["--file", cleanFile]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("PASS");
  });

  test("--typecheck still exits non-zero and still reports the AST violation count", async () => {
    const { repoDir } = createScratchContext("spawn-typecheck-still-audits");
    const anyOnlyFile = join(repoDir, "any-only.ts");
    // Valid TypeScript (typecheck alone would pass), but violates the always-on AST audit.
    writeFileSync(anyOnlyFile, "export const data: any = 100;\n");

    const { exitCode, stdout } = await spawnTaskCheck(["--file", anyOnlyFile, "--typecheck"]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("FAIL");
    expect(stdout).toContain("AST Static Invariant");
    expect(stdout).not.toContain("0 violations");
  });

  test("exit-code propagation is not fooled by a --file path containing the substring 'test'", async () => {
    const { repoDir } = createScratchContext("spawn-path-contains-test-substring");
    const testNamedFile = join(repoDir, "fixture.test.ts");
    writeFileSync(testNamedFile, "export const leaked: any = 1;\n");

    const { exitCode } = await spawnTaskCheck(["--file", testNamedFile, "--typecheck"]);
    expect(exitCode).not.toBe(0);
  });
});
