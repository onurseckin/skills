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
  const rootDir = `/virtual/tmp/task-check-${label}-${++scratchCount}`;
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
