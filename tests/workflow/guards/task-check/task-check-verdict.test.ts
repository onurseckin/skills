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
