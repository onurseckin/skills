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
} from "../../../olt/scripts/src/cli/commands/task-check.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { ALL_AST_LINT_RULES } from "../../../olt/scripts/src/linter/ast-enforcer.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function createScratchContext(label: string): {
  readonly rootDir: string;
  readonly repoDir: string;
} {
  const rootDir = scratchRoot(import.meta.path, label);
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

describe("task-check: SUPPORTED_EXTENSIONS and isSupportedSourceFile", () => {
  test("SUPPORTED_EXTENSIONS contains all standard TypeScript and JavaScript extensions", () => {
    const expectedExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
    for (const ext of expectedExtensions) {
      expect(SUPPORTED_EXTENSIONS.includes(ext)).toBe(true);
    }
    expect(SUPPORTED_EXTENSIONS.length).toBe(expectedExtensions.length);
  });

  test("isSupportedSourceFile returns true for supported extensions", () => {
    expect(isSupportedSourceFile("index.ts")).toBe(true);
    expect(isSupportedSourceFile("Component.tsx")).toBe(true);
    expect(isSupportedSourceFile("module.mts")).toBe(true);
    expect(isSupportedSourceFile("config.cts")).toBe(true);
    expect(isSupportedSourceFile("bundle.js")).toBe(true);
    expect(isSupportedSourceFile("view.jsx")).toBe(true);
    expect(isSupportedSourceFile("server.mjs")).toBe(true);
    expect(isSupportedSourceFile("legacy.cjs")).toBe(true);
  });

  test("isSupportedSourceFile returns false for unsupported file extensions and non-code files", () => {
    expect(isSupportedSourceFile("package.json")).toBe(false);
    expect(isSupportedSourceFile("README.md")).toBe(false);
    expect(isSupportedSourceFile("styles.css")).toBe(false);
    expect(isSupportedSourceFile("index.html")).toBe(false);
    expect(isSupportedSourceFile("script.py")).toBe(false);
    expect(isSupportedSourceFile("Makefile")).toBe(false);
    expect(isSupportedSourceFile("")).toBe(false);
    expect(isSupportedSourceFile("app.ts.bak")).toBe(false);
  });
});

describe("task-check: collectSourceFilesRecursively", () => {
  test("returns empty array for non-existent directory", () => {
    const files = collectSourceFilesRecursively("/tmp/non-existent-dir-12345");
    expect(files).toEqual([]);
  });

  test("returns empty array when currentDepth exceeds maxDepth", () => {
    const { repoDir } = createScratchContext("max-depth");
    const subDir = join(repoDir, "level1", "level2");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "file.ts"), "export const x = 1;\n");

    const files = collectSourceFilesRecursively(repoDir, 1, 2);
    expect(files).toEqual([]);
  });

  test("recursively collects supported files and excludes node_modules and .git", () => {
    const { repoDir } = createScratchContext("recursive-collection");

    const srcDir = join(repoDir, "src");
    const nestedDir = join(srcDir, "nested");
    const nodeModulesDir = join(repoDir, "node_modules", "package");
    const gitDir = join(repoDir, ".git", "hooks");

    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(nodeModulesDir, { recursive: true });
    mkdirSync(gitDir, { recursive: true });

    writeFileSync(join(srcDir, "root.ts"), "export const root = 1;\n");
    writeFileSync(join(nestedDir, "child.tsx"), "export const child = 2;\n");
    writeFileSync(join(srcDir, "notes.md"), "# Notes\n");
    writeFileSync(join(nodeModulesDir, "dep.ts"), "export const dep = 3;\n");
    writeFileSync(join(gitDir, "hook.ts"), "export const hook = 4;\n");

    const collected = collectSourceFilesRecursively(repoDir);

    expect(collected.some((f) => f.endsWith("src/root.ts"))).toBe(true);
    expect(collected.some((f) => f.endsWith("src/nested/child.tsx"))).toBe(true);
    expect(collected.some((f) => f.endsWith("notes.md"))).toBe(false);
    expect(collected.some((f) => f.includes("node_modules"))).toBe(false);
    expect(collected.some((f) => f.includes(".git"))).toBe(false);
  });
});

describe("task-check: findNearestTsconfig", () => {
  test("finds tsconfig.json in the same directory as the target file", () => {
    const { repoDir } = createScratchContext("find-tsconfig-same-dir");
    const tsconfigPath = join(repoDir, "tsconfig.json");
    const filePath = join(repoDir, "index.ts");

    writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: {} }));
    writeFileSync(filePath, "export const a = 1;");

    const found = findNearestTsconfig(filePath);
    expect(found).toBe(tsconfigPath);
  });

  test("finds tsconfig.json in a parent directory when file is nested", () => {
    const { repoDir } = createScratchContext("find-tsconfig-parent-dir");
    const tsconfigPath = join(repoDir, "tsconfig.json");
    const nestedDir = join(repoDir, "packages", "core", "src");
    const filePath = join(nestedDir, "app.ts");

    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: {} }));
    writeFileSync(filePath, "export const app = true;");

    const found = findNearestTsconfig(filePath);
    expect(found).toBe(tsconfigPath);
  });

  test("finds tsconfig when filePath itself is a directory containing tsconfig", () => {
    const { repoDir } = createScratchContext("find-tsconfig-dir");
    const tsconfigPath = join(repoDir, "tsconfig.json");
    writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: {} }));

    const found = findNearestTsconfig(repoDir);
    expect(found).toBe(tsconfigPath);
  });
});

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

describe("task-check: performIncrementalTypecheck", () => {
  test("returns passed with 0 files when given empty or non-existent file list", () => {
    const result = performIncrementalTypecheck([]);
    expect(result.passed).toBe(true);
    expect(result.totalFiles).toBe(0);
    expect(result.totalErrors).toBe(0);
    expect(result.totalWarnings).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  test("passes valid TypeScript files with 0 errors", () => {
    const { repoDir } = createScratchContext("typecheck-clean");
    const validFile = join(repoDir, "clean.ts");
    writeFileSync(
      validFile,
      `export interface User {
  readonly id: string;
  readonly count: number;
}
export function increment(user: User): number {
  return user.count + 1;
}
`,
    );

    const result = performIncrementalTypecheck([validFile]);
    expect(result.passed).toBe(true);
    expect(result.totalFiles).toBe(1);
    expect(result.totalErrors).toBe(0);
    expect(result.diagnostics.length).toBe(0);
  });

  test("detects TypeScript type errors and returns structured diagnostics", () => {
    const { repoDir } = createScratchContext("typecheck-error");
    const errorFile = join(repoDir, "type-error.ts");
    writeFileSync(
      errorFile,
      `export function testTypeMismatch(): number {
  const value: number = "not-a-number";
  return value;
}
`,
    );

    const result = performIncrementalTypecheck([errorFile]);
    expect(result.passed).toBe(false);
    expect(result.totalFiles).toBe(1);
    expect(result.totalErrors).toBeGreaterThanOrEqual(1);

    const errorDiag = result.diagnostics.find((d) => d.category === "error");
    expect(errorDiag).toBeDefined();
    if (errorDiag !== undefined) {
      expect(errorDiag.file).toContain("type-error.ts");
      expect(errorDiag.line).toBe(2);
      expect(errorDiag.code).toBe(2322); // Type 'string' is not assignable to type 'number'
      expect(errorDiag.message).toContain("Type 'string' is not assignable to type 'number'");
      expect(errorDiag.snippet).toBeDefined();
    }
  });

  test("detects failures across multiple files when one is broken", () => {
    const { repoDir } = createScratchContext("typecheck-multi");
    const goodFile = join(repoDir, "good.ts");
    const badFile = join(repoDir, "bad.ts");

    writeFileSync(goodFile, "export const goodNumber: number = 42;\n");
    writeFileSync(badFile, "export const badBoolean: boolean = 12345;\n");

    const result = performIncrementalTypecheck([goodFile, badFile]);
    expect(result.passed).toBe(false);
    expect(result.totalFiles).toBe(2);
    expect(result.totalErrors).toBeGreaterThanOrEqual(1);
  });

  test("handles compilation under project tsconfig.json properly", () => {
    const { repoDir } = createScratchContext("typecheck-tsconfig");
    const tsconfigPath = join(repoDir, "tsconfig.json");
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
        },
      }),
    );

    const tsFile = join(repoDir, "project-file.ts");
    writeFileSync(
      tsFile,
      `export const status: "active" | "inactive" = "active";
export function getStatus(): string {
  return status;
}
`,
    );

    const result = performIncrementalTypecheck([tsFile]);
    expect(result.passed).toBe(true);
    expect(result.totalErrors).toBe(0);
  });
});

describe("task-check: performAstLintCheck", () => {
  test("returns passed with 0 files when given empty or non-existent file list", () => {
    const result = performAstLintCheck([]);
    expect(result.passed).toBe(true);
    expect(result.totalFiles).toBe(0);
    expect(result.totalViolations).toBe(0);
    expect(result.violations).toEqual([]);
    for (const rule of ALL_AST_LINT_RULES) {
      expect(result.summaryByRule[rule]).toBe(0);
    }
  });

  test("passes clean TypeScript files without AST violations", () => {
    const { repoDir } = createScratchContext("lint-clean");
    const cleanFile = join(repoDir, "clean.ts");
    writeFileSync(
      cleanFile,
      `export interface UserData {
  readonly id: string;
  readonly name: string;
}
export function formatUser(user: UserData): string {
  return \`\${user.name} (\${user.id})\`;
}
`,
    );

    const result = performAstLintCheck([cleanFile]);
    expect(result.passed).toBe(true);
    expect(result.totalFiles).toBe(1);
    expect(result.totalViolations).toBe(0);
    expect(result.violations.length).toBe(0);
  });

  test("detects explicit 'any' type keyword violation", () => {
    const { repoDir } = createScratchContext("lint-any");
    const anyFile = join(repoDir, "any-violation.ts");
    writeFileSync(
      anyFile,
      `export function parsePayload(data: any): string {
  return String(data);
}
`,
    );

    const result = performAstLintCheck([anyFile]);
    expect(result.passed).toBe(false);
    expect(result.totalViolations).toBeGreaterThanOrEqual(1);
    expect(result.summaryByRule["any_type"]).toBeGreaterThanOrEqual(1);

    const anyViolation = result.violations.find((v) => v.rule === "any_type");
    expect(anyViolation).toBeDefined();
    if (anyViolation !== undefined) {
      expect(anyViolation.file).toBe(anyFile);
      expect(anyViolation.line).toBe(1);
    }
  });

  test("detects compiler suppression directive violations (@ts-ignore, @ts-expect-error, eslint-disable)", () => {
    const { repoDir } = createScratchContext("lint-suppressions");
    const ignoreFile = join(repoDir, "ignore.ts");
    writeFileSync(
      ignoreFile,
      `// @ts-ignore
export const a = 10;
// @ts-expect-error
export const b = 20;
/* eslint-disable */
export const c = 30;
`,
    );

    const result = performAstLintCheck([ignoreFile]);
    expect(result.passed).toBe(false);
    expect(result.totalViolations).toBeGreaterThanOrEqual(3);
    expect(result.summaryByRule["compiler_suppression"]).toBeGreaterThanOrEqual(3);

    const suppressionViolations = result.violations.filter(
      (v) => v.rule === "compiler_suppression",
    );
    expect(suppressionViolations.length).toBeGreaterThanOrEqual(3);
  });

  test("detects non-null assertion operator violations", () => {
    const { repoDir } = createScratchContext("lint-non-null");
    const nonNullFile = join(repoDir, "non-null.ts");
    writeFileSync(
      nonNullFile,
      `export function getLength(str?: string): number {
  return str!.length;
}
`,
    );

    const result = performAstLintCheck([nonNullFile]);
    expect(result.passed).toBe(false);
    expect(result.summaryByRule["non_null_assertion"]).toBeGreaterThanOrEqual(1);
  });

  test("aggregates AST violations across multiple checked files", () => {
    const { repoDir } = createScratchContext("lint-multi");
    const cleanFile = join(repoDir, "clean.ts");
    const anyFile = join(repoDir, "any.ts");
    const suppFile = join(repoDir, "supp.ts");

    writeFileSync(cleanFile, "export const x: number = 1;\n");
    writeFileSync(anyFile, "export const y: any = 2;\n");
    writeFileSync(suppFile, "// @ts-ignore\nexport const z: number = 3;\n");

    const result = performAstLintCheck([cleanFile, anyFile, suppFile]);
    expect(result.passed).toBe(false);
    expect(result.totalFiles).toBe(3);
    expect(result.totalViolations).toBeGreaterThanOrEqual(2);
    expect(result.summaryByRule["any_type"]).toBeGreaterThanOrEqual(1);
    expect(result.summaryByRule["compiler_suppression"]).toBeGreaterThanOrEqual(1);
  });
});

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
  const repoRoot = join(import.meta.dir, "..", "..", "..");
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
