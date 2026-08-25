import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  collectSourceFilesRecursively,
  findNearestTsconfig,
  formatTaskCheckMarkdown,
  isSupportedSourceFile,
  performAstLintCheck,
  performIncrementalTypecheck,
  resolveTargetFiles,
  SUPPORTED_EXTENSIONS,
  taskCheckCommand,
  type TaskCheckSummary,
} from "../../../olt/scripts/src/cli/commands/task-check.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterAll(async () => cleanupRoots(roots));

describe("task:check command and helpers", () => {
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
    const root = await mkdtemp(join(tmpdir(), "task-check-collect-"));
    roots.push(root);

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

    // Max depth exceeded
    const empty = collectSourceFilesRecursively(root, 0, 1);
    expect(empty.length).toBe(0);

    // Non-existent path
    const nonExistent = collectSourceFilesRecursively(join(root, "does-not-exist"));
    expect(nonExistent.length).toBe(0);
  });

  test("findNearestTsconfig discovers tsconfig in hierarchy", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-check-tsconfig-"));
    roots.push(root);

    await mkdir(join(root, "sub", "deep"), { recursive: true });
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    await writeFile(join(root, "sub", "deep", "file.ts"), "export const a = 1;");

    const found = findNearestTsconfig(join(root, "sub", "deep", "file.ts"));
    expect(found).toBeDefined();
    expect(found).toContain(root);

    const dirFound = findNearestTsconfig(join(root, "sub", "deep"));
    expect(dirFound).toBeDefined();

    const notOnDisk = findNearestTsconfig(join(root, "non-existent-file.ts"));
    expect(notOnDisk).toBeDefined();
  });

  test("performIncrementalTypecheck checks files accurately", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-check-typecheck-"));
    roots.push(root);

    await writeFile(
      join(root, "tsconfig.json"),
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

    const cleanFile = join(root, "clean.ts");
    await writeFile(cleanFile, "export const clean: number = 42;\n");

    const cleanResult = performIncrementalTypecheck([cleanFile]);
    expect(cleanResult.passed).toBe(true);
    expect(cleanResult.totalErrors).toBe(0);
    expect(cleanResult.totalFiles).toBe(1);

    const errorFile = join(root, "error.ts");
    await writeFile(errorFile, 'export const err: number = "not-a-number";\n');

    const errorResult = performIncrementalTypecheck([cleanFile, errorFile]);
    expect(errorResult.passed).toBe(false);
    expect(errorResult.totalErrors).toBeGreaterThan(0);
    expect(errorResult.diagnostics.length).toBeGreaterThan(0);

    // Empty list
    const emptyResult = performIncrementalTypecheck([]);
    expect(emptyResult.passed).toBe(true);
    expect(emptyResult.totalFiles).toBe(0);
  }, 30_000);

  test("performAstLintCheck verifies AST invariants", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-check-lint-"));
    roots.push(root);

    const cleanFile = join(root, "clean.ts");
    await writeFile(cleanFile, "export const value: number = 100;\n");

    const cleanResult = performAstLintCheck([cleanFile]);
    expect(cleanResult.passed).toBe(true);
    expect(cleanResult.totalViolations).toBe(0);

    const violationFile = join(root, "violation.ts");
    // TypeScript any violation and suppression
    await writeFile(violationFile, "// @ts-ignore\nexport const anyValue: any = 'test';\n");

    const violationResult = performAstLintCheck([violationFile]);
    expect(violationResult.passed).toBe(false);
    expect(violationResult.totalViolations).toBeGreaterThan(0);

    // Empty files
    const emptyResult = performAstLintCheck([]);
    expect(emptyResult.passed).toBe(true);
  }, 30_000);

  test("formatTaskCheckMarkdown formats pass and fail summaries", () => {
    const passSummary: TaskCheckSummary = {
      passed: true,
      runRoot: ".olt/capsules/run-01",
      taskId: "task-01",
      filesChecked: ["src/file1.ts", "src/file2.ts"],
      durationMs: 125,
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

  test("resolveTargetFiles handles file flags, task scopes, and whole run", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-check-resolve-"));
    roots.push(root);

    const f1 = join(root, "f1.ts");
    const f2 = join(root, "f2.ts");
    await writeFile(f1, "export const f1 = 1;");
    await writeFile(f2, "export const f2 = 2;");

    // 1. File flags with commas
    const explicit = resolveTargetFiles({ fileFlags: [`${f1}, ${f2}`] });
    expect(explicit.length).toBe(2);

    // 2. Directory in file flags
    const dirExplicit = resolveTargetFiles({ fileFlags: [root] });
    expect(dirExplicit.length).toBe(2);

    // 3. Task without run throws
    expect(() => resolveTargetFiles({ taskId: "task-01" })).toThrow("--run is required");
  });

  test("taskCheckCommand runs full verification end to end", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-check-e2e-"));
    roots.push(root);

    await writeFile(
      join(root, "tsconfig.json"),
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

    const cleanPath = join(root, "clean.ts");
    await writeFile(cleanPath, "export const cleanVal = 10;\n");

    // Command with explicit file
    const res = await taskCheckCommand({
      file: cleanPath,
    });
    expect(res.passed).toBe(true);
    expect(typeof res.markdown).toBe("string");

    // Command with --typecheck only: adds the typecheck to the always-on AST lint audit,
    // it does not replace it, so both are present on a clean file.
    const tcOnly = await taskCheckCommand({
      file: cleanPath,
      typecheck: true,
    });
    expect(tcOnly.typecheck).toBeDefined();
    expect(tcOnly.lint).toBeDefined();

    // Command with --lint only
    const lintOnly = await taskCheckCommand({
      file: cleanPath,
      lint: true,
    });
    expect(lintOnly.typecheck).toBeUndefined();
    expect(lintOnly.lint).toBeDefined();

    // Command with missing arguments throws
    await expect(taskCheckCommand({})).rejects.toThrow(
      "Must specify --file, --task (with --run), or --run",
    );

    // Command dispatch via execute
    const dispatched = await execute(["task:check", "--file", cleanPath]);
    expect(dispatched.passed).toBe(true);
  }, 30_000);
});
