import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import {
  collectSourceFilesRecursively,
  findNearestTsconfig,
  performAstLintCheck,
  performIncrementalTypecheck,
  readRunTasks,
} from "../../../../../olt/scripts/src/cli/commands/task-check.ts";
import * as coreModule from "../../../../../olt/scripts/src/core/index.ts";
import * as storeModule from "../../../../../olt/scripts/src/engine/store/index.ts";
import * as integrationModule from "../../../../../olt/scripts/src/integration/index.ts";
import * as astLinterModule from "../../../../../olt/scripts/src/linter/ast/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("task:check - Diagnostics, AST Invariants & Compiler Environments", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("findNearestTsconfig handles virtual boundaries and cwd fallback", async () => {
    const root = await createVirtualDir("tsconfig-boundaries");
    const subDir = join(root, "sub");
    await mkdir(subDir, { recursive: true });
    const tsconfig = join(root, "tsconfig.json");
    await writeFile(tsconfig, "{}");

    expect(findNearestTsconfig(subDir)).toBe(tsconfig);
    expect(findNearestTsconfig(join(subDir, "missing.ts"))).toBe(tsconfig);

    const nonVirtualDir = "/virtual/orphan/sub";
    expect(findNearestTsconfig(nonVirtualDir)).toBeUndefined();

    const envSpy = spyOn(coreModule, "isTestEnvironment").mockReturnValue(false);
    try {
      const liveFound = findNearestTsconfig(subDir);
      expect(liveFound).toBe(tsconfig);

      const origFileExists = ts.sys.fileExists;
      ts.sys.fileExists = (p: string) => {
        if (p === join(process.cwd(), "tsconfig.json")) {
          return true;
        }
        return false;
      };
      try {
        expect(findNearestTsconfig("/isolated/path.ts")).toBe(join(process.cwd(), "tsconfig.json"));
      } finally {
        ts.sys.fileExists = origFileExists;
      }
    } finally {
      envSpy.mockRestore();
    }
  });

  test("performIncrementalTypecheck handles test mode diagnostics and categories", async () => {
    expect(performIncrementalTypecheck([]).passed).toBe(true);
    expect(performIncrementalTypecheck(["/non-existent.ts"]).passed).toBe(true);

    const root = await createVirtualDir("typecheck-diags");
    const validTs = join(root, "valid.ts");
    await writeFile(validTs, "export const num: number = 100;\n");
    const validRes = performIncrementalTypecheck([validTs]);
    expect(validRes.passed).toBe(true);
    expect(validRes.totalFiles).toBe(1);
    expect(validRes.totalErrors).toBe(0);

    const errTs = join(root, "err.ts");
    await writeFile(errTs, "export const wrong: number = 'not a number';\n");
    const errRes = performIncrementalTypecheck([errTs]);
    expect(errRes.passed).toBe(false);
    expect(errRes.totalErrors).toBeGreaterThan(0);
    expect(errRes.diagnostics.some((d) => d.category === "error")).toBe(true);
    expect(errRes.diagnostics[0]?.snippet).toBeDefined();
  });

  test("performIncrementalTypecheck handles live compiler multi-groups and fallback files", async () => {
    const root = await createVirtualDir("live-typecheck-suite");
    const tsconfigPath = join(root, "tsconfig.json");
    await writeFile(tsconfigPath, JSON.stringify({ compilerOptions: { target: "ESNext" } }));
    const fileA = join(root, "fileA.ts");
    const fileB = join(root, "fileB.ts");
    await writeFile(fileA, "export const a: number = 1;\n");
    await writeFile(fileB, "export const b: number = 2;\n");

    const noConfigDir = await createVirtualDir("no-config-suite");
    const fallbackA = join(noConfigDir, "fbA.ts");
    const fallbackB = join(noConfigDir, "fbB.ts");
    await writeFile(fallbackA, "export const fbErr: number = 'bad string';\n");
    await writeFile(fallbackB, "export const y: string = 'test';\n");

    const envSpy = spyOn(coreModule, "isTestEnvironment").mockReturnValue(false);
    try {
      const origFileExists = ts.sys.fileExists;
      ts.sys.fileExists = (p: string) => {
        if (p === tsconfigPath) return true;
        return false;
      };
      try {
        const liveRes = performIncrementalTypecheck([fileA, fileB, fallbackA, fallbackB]);
        expect(liveRes.passed).toBe(false);
        expect(liveRes.totalErrors).toBeGreaterThan(0);
        expect(liveRes.diagnostics.some((d) => d.file.endsWith("fbA.ts"))).toBe(true);
      } finally {
        ts.sys.fileExists = origFileExists;
      }

      const corruptDir = await createVirtualDir("corrupt-read-dir");
      const corruptConfig = join(corruptDir, "tsconfig.json");
      await writeFile(corruptConfig, "{}");
      const corruptTs = join(corruptDir, "corrupt.ts");
      await writeFile(corruptTs, "export const c = 1;\n");

      const origReadDir = ts.sys.readDirectory;
      ts.sys.readDirectory = (p, extensions, excludes, includes, depth) => {
        if (p.includes("corrupt-read-dir")) {
          throw new Error("Simulated file tree read error");
        }
        return origReadDir ? origReadDir(p, extensions, excludes, includes, depth) : [];
      };
      try {
        const errRes = performIncrementalTypecheck([corruptTs]);
        expect(errRes.passed).toBe(false);
        expect(errRes.diagnostics.some((d) => d.code === 9999)).toBe(true);
      } finally {
        ts.sys.readDirectory = origReadDir;
      }
    } finally {
      envSpy.mockRestore();
    }
  });

  test("performAstLintCheck handles rule tracking and dynamic violations", async () => {
    const root = await createVirtualDir("ast-rules-suite");
    const srcFile = join(root, "test.ts");
    await writeFile(srcFile, "export const val = 100;\n");

    const lintSpy = spyOn(astLinterModule, "lintFile").mockImplementation((() => ({
      passed: false,
      violations: [
        {
          rule: "custom_rule" as astLinterModule.AstLintRule,
          file: srcFile,
          line: 1,
          column: 1,
          snippet: "",
          message: "Custom violation detected",
        },
      ],
    })) as never);

    try {
      const res = performAstLintCheck([srcFile]);
      expect(res.passed).toBe(false);
      expect(res.totalViolations).toBe(1);
      expect(res.summaryByRule.custom_rule).toBe(1);
    } finally {
      lintSpy.mockRestore();
    }
  });

  test("readRunTasks and collectSourceFilesRecursively edge cases", async () => {
    const root = await createVirtualDir("tasks-fallback-read");
    const loadRunSpy = spyOn(storeModule, "loadRun").mockImplementation((() => ({
      state: {},
    })) as never);

    const wfSpy = spyOn(integrationModule, "workflowPort").mockImplementation((() => ({
      read: () => ({
        tasks: {
          "wf-task-1": {
            id: "wf-task-1",
            status: "ready",
            target_files: ["/path/f1.ts"],
          },
        },
      }),
    })) as never);

    try {
      const tasks = readRunTasks(root);
      expect(tasks["wf-task-1"]).toBeDefined();
    } finally {
      loadRunSpy.mockRestore();
      wfSpy.mockRestore();
    }

    const collectRoot = await createVirtualDir("collect-ignored-dirs");
    for (const d of ["node_modules", ".git", "dist", "build", "coverage"]) {
      await mkdir(join(collectRoot, d), { recursive: true });
      await writeFile(join(collectRoot, d, "ignored.ts"), "export const x = 1;");
    }
    await writeFile(join(collectRoot, "valid.ts"), "export const ok = true;");
    const files = collectSourceFilesRecursively(collectRoot);
    expect(files.length).toBe(1);
    expect(files[0]?.endsWith("valid.ts")).toBe(true);

    const readdirSpy = spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("Simulated readdir error");
    });
    try {
      expect(collectSourceFilesRecursively(collectRoot)).toEqual([]);
    } finally {
      readdirSpy.mockRestore();
    }
  });
});
