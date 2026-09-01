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
  const rootDir = `/virtual/tmp/task-check-ast-${label}-${++scratchCount}`;
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

describe("task-check: formatTaskCheckMarkdown", () => {
  test("formats passing summary with single file heading", () => {
    const summary: TaskCheckSummary = {
      passed: true,
      filesChecked: ["/path/to/src/index.ts"],
      durationMs: 12,
      format: "markdown",
      markdown: "",
      typecheck: {
        passed: true,
        totalFiles: 1,
        totalErrors: 0,
        totalWarnings: 0,
        diagnostics: [],
      },
      lint: {
        passed: true,
        totalFiles: 1,
        totalViolations: 0,
        violations: [],
        summaryByRule: {},
      },
    };

    const formatted = formatTaskCheckMarkdown(summary);
    expect(formatted).toContain("### ⚡ Incremental Verification: File `/path/to/src/index.ts`");
    expect(formatted).toContain("✅ **PASS: All Incremental Verification Invariants Satisfied**");
    expect(formatted).toContain("- **Files Audited**: 1");
    expect(formatted).toContain("#### 🔷 TypeScript Incremental Type Check");
    expect(formatted).toContain("- Status: **Passed** (0 errors across 1 files)");
    expect(formatted).toContain("#### 🛡️ AST Static Invariant & Linter Audit");
    expect(formatted).toContain(
      "- Status: **Passed** (0 violations, strict 0 'any', 0 compiler suppressions maintained)",
    );
  });

  test("formats summary with multiple files heading", () => {
    const summary: TaskCheckSummary = {
      passed: true,
      filesChecked: ["/path/a.ts", "/path/b.ts", "/path/c.ts"],
      durationMs: 20,
      format: "markdown",
      markdown: "",
    };

    const formatted = formatTaskCheckMarkdown(summary);
    expect(formatted).toContain("### ⚡ Incremental Verification: 3 Target Files");
  });

  test("formats failing summary with task ID and tables for type errors and lint violations", () => {
    const typecheckResult: TypeCheckResult = {
      passed: false,
      totalFiles: 2,
      totalErrors: 1,
      totalWarnings: 0,
      diagnostics: [
        {
          file: "/path/to/src/bad.ts",
          line: 10,
          column: 5,
          code: 2322,
          message: "Type 'string' is not assignable to type 'number' | null",
          category: "error",
        },
      ],
    };

    const lintResult: LintCheckResult = {
      passed: false,
      totalFiles: 2,
      totalViolations: 1,
      violations: [
        {
          rule: "any_type",
          file: "/path/to/src/bad.ts",
          line: 5,
          column: 15,
          message: "Explicit 'any' type is prohibited; specify an exact type.",
          snippet: "const val: any = 1;",
        },
      ],
      summaryByRule: { any_type: 1 },
    };

    const summary: TaskCheckSummary = {
      passed: false,
      runRoot: ".olt/capsules/test-run-123",
      taskId: "task-feat-auth",
      filesChecked: ["/path/to/src/bad.ts", "/path/to/src/good.ts"],
      durationMs: 45,
      format: "markdown",
      markdown: "",
      typecheck: typecheckResult,
      lint: lintResult,
    };

    const formatted = formatTaskCheckMarkdown(summary);
    expect(formatted).toContain("### ⚡ Incremental Verification: Task `task-feat-auth`");
    expect(formatted).toContain("❌ **FAIL: Verification Violations Detected**");
    expect(formatted).toContain("- **Capsule Run**: `.olt/capsules/test-run-123`");
    expect(formatted).toContain("- **Task ID**: `task-feat-auth`");
    expect(formatted).toContain("- Status: **Failed** (1 errors across 2 files)");
    expect(formatted).toContain("- Status: **Failed** (1 violations in 2 files)");
    expect(formatted).toContain("`any_type`");
    expect(formatted).toContain("TS2322");
    // Escaped pipe check
    expect(formatted).toContain("\\|");
  });

  test("includes truncation note when diagnostics or violations exceed 10 items", () => {
    const diagnostics = [];
    for (let i = 1; i <= 15; i++) {
      diagnostics.push({
        file: "/path/file.ts",
        line: i,
        column: 1,
        code: 1000 + i,
        message: `Error number ${i}`,
        category: "error" as const,
      });
    }

    const violations = [];
    for (let i = 1; i <= 15; i++) {
      violations.push({
        rule: "any_type" as const,
        file: "/path/file.ts",
        line: i,
        column: 1,
        message: `Violation number ${i}`,
        snippet: "any",
      });
    }

    const summary: TaskCheckSummary = {
      passed: false,
      filesChecked: ["/path/file.ts"],
      durationMs: 30,
      format: "markdown",
      markdown: "",
      typecheck: {
        passed: false,
        totalFiles: 1,
        totalErrors: 15,
        totalWarnings: 0,
        diagnostics,
      },
      lint: {
        passed: false,
        totalFiles: 1,
        totalViolations: 15,
        violations,
        summaryByRule: { any_type: 15 },
      },
    };

    const formatted = formatTaskCheckMarkdown(summary);
    expect(formatted).toContain("additional type errors");
    expect(formatted).toContain("additional invariant violations");
  });
});
