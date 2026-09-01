import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  collectSourceFilesRecursively,
  findNearestTsconfig,
  formatTaskCheckMarkdown,
  isSupportedSourceFile,
  performAstLintCheck,
  performIncrementalTypecheck,
  SUPPORTED_EXTENSIONS,
  type TaskCheckSummary,
} from "../../../../../olt/scripts/src/cli/commands/task-check.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("task:check - File Inspection & AST Linting", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("isSupportedSourceFile identifies valid extensions", () => {
    expect(SUPPORTED_EXTENSIONS.length).toBeGreaterThan(0);
    expect(isSupportedSourceFile("test.ts")).toBe(true);
    expect(isSupportedSourceFile("test.tsx")).toBe(true);
    expect(isSupportedSourceFile("test.mts")).toBe(true);
    expect(isSupportedSourceFile("test.cts")).toBe(true);
    expect(isSupportedSourceFile("test.js")).toBe(true);
    expect(isSupportedSourceFile("test.jsx")).toBe(true);
    expect(isSupportedSourceFile("test.mjs")).toBe(true);
    expect(isSupportedSourceFile("test.cjs")).toBe(true);
    expect(isSupportedSourceFile("test.json")).toBe(false);
    expect(isSupportedSourceFile("test.md")).toBe(false);
    expect(isSupportedSourceFile("test.py")).toBe(false);
  });

  test("collectSourceFilesRecursively collects nested files", async () => {
    const root = await createVirtualDir("task-check-collect");

    await mkdir(join(root, "src", "nested"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });

    await writeFile(join(root, "src", "index.ts"), "export const a = 1;");
    await writeFile(join(root, "src", "nested", "util.tsx"), "export const b = 2;");
    await writeFile(join(root, "src", "readme.md"), "# Readme");
    await writeFile(join(root, "node_modules", "pkg", "index.ts"), "export const c = 3;");
    await writeFile(join(root, ".git", "head.ts"), "export const d = 4;");

    const files = collectSourceFilesRecursively(root);
    expect(files.length).toBe(2);
    expect(files.some((f) => f.endsWith("index.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("util.tsx"))).toBe(true);
  });

  test("findNearestTsconfig locates tsconfig up directory tree", async () => {
    const root = await createVirtualDir("task-check-tsconfig");

    const nested = join(root, "a", "b", "c");
    await mkdir(nested, { recursive: true });
    const tsconfig = join(root, "tsconfig.json");
    await writeFile(tsconfig, "{}");

    expect(findNearestTsconfig(nested)).toBe(tsconfig);
    expect(findNearestTsconfig(join(root, "a"))).toBe(tsconfig);
  });

  test("performAstLintCheck detects forbidden patterns (any, ts-ignore, eslint-disable)", async () => {
    const root = await createVirtualDir("task-check-lint");

    const badFile = join(root, "bad.ts");
    await writeFile(
      badFile,
      `
      // @ts-ignore
      /* eslint-disable */
      // @ts-nocheck
      // @ts-expect-error
      /* oxlint-disable */
      const x: any = 1;
      const y = x as any;
      `,
    );

    const cleanFile = join(root, "clean.ts");
    await writeFile(cleanFile, `export const good: number = 42;`);

    const result = performAstLintCheck([badFile, cleanFile]);
    expect(result.passed).toBe(false);
    expect(result.totalFiles).toBe(2);
    expect(result.totalViolations).toBeGreaterThan(0);
    expect(result.summaryByRule.any_type).toBeGreaterThan(0);
    expect(result.summaryByRule.compiler_suppression).toBeGreaterThan(0);
  });

  test("performIncrementalTypecheck checks files with ts program", async () => {
    const root = await createVirtualDir("task-check-typecheck");

    const validTs = join(root, "valid.ts");
    await writeFile(validTs, "export const num: number = 10;");

    const result = performIncrementalTypecheck([validTs]);
    expect(result.totalFiles).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.totalErrors).toBe(0);

    const invalidTs = join(root, "invalid.ts");
    await writeFile(invalidTs, "export const text: string = 10;");

    const failResult = performIncrementalTypecheck([invalidTs]);
    expect(failResult.passed).toBe(false);
    expect(failResult.totalErrors).toBeGreaterThan(0);
  });

  test("formatTaskCheckMarkdown formats pass and fail summaries", () => {
    const passSummary: TaskCheckSummary = {
      passed: true,
      filesChecked: ["src/a.ts", "src/b.ts"],
      taskId: "task-01",
      durationMs: 120,
      format: "markdown",
      markdown: "",
      typecheck: {
        passed: true,
        totalFiles: 2,
        totalErrors: 0,
        totalWarnings: 0,
        diagnostics: [],
      },
      lint: {
        passed: true,
        totalFiles: 2,
        totalViolations: 0,
        violations: [],
        summaryByRule: {},
      },
    };

    const passMd = formatTaskCheckMarkdown(passSummary);
    expect(passMd).toContain("PASS");
    expect(passMd).toContain("Task `task-01`");
    expect(passMd).toContain("TypeScript Incremental Type Check");

    const failSummary: TaskCheckSummary = {
      passed: false,
      filesChecked: ["src/single.ts"],
      durationMs: 250,
      format: "markdown",
      markdown: "",
      typecheck: {
        passed: false,
        totalFiles: 1,
        totalErrors: 12,
        totalWarnings: 0,
        diagnostics: Array.from({ length: 12 }, (_, i) => ({
          file: "src/single.ts",
          line: i + 1,
          column: 1,
          code: 2322,
          message: `Type error ${i + 1} with | pipe`,
          category: "error" as const,
        })),
      },
      lint: {
        passed: false,
        totalFiles: 1,
        totalViolations: 12,
        violations: Array.from({ length: 12 }, (_, i) => ({
          rule: "any_type" as const,
          file: "src/single.ts",
          line: i + 1,
          column: 5,
          snippet: "let x: any;",
          message: `Violation ${i + 1}`,
        })),
        summaryByRule: { any_type: 12 },
      },
    };

    const failMd = formatTaskCheckMarkdown(failSummary);
    expect(failMd).toContain("FAIL");
    expect(failMd).toContain("File `src/single.ts`");
    expect(failMd).toContain("additional type errors");
    expect(failMd).toContain("additional invariant violations");
  });
});
