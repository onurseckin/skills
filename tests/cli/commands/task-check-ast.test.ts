import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  collectSourceFilesRecursively,
  isSupportedSourceFile,
  performAstLintCheck,
  readRunTasks,
  resolveTargetFiles,
  SUPPORTED_EXTENSIONS,
} from "../../../olt/scripts/src/cli/commands/task-check.ts";
import * as astLinter from "../../../olt/scripts/src/linter/ast/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "./fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
async function createVirtualDir(prefix: string): Promise<string> {
  const dir = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(dir);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("task:check - AST & File Inventory Suite", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });
  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("SUPPORTED_EXTENSIONS and isSupportedSourceFile", () => {
    for (const ext of SUPPORTED_EXTENSIONS) expect(isSupportedSourceFile(`f${ext}`)).toBe(true);
    expect(isSupportedSourceFile("f.json")).toBe(false);
    expect(isSupportedSourceFile("f.py")).toBe(false);
    expect(isSupportedSourceFile("")).toBe(false);
    expect(isSupportedSourceFile("test.ts.bak")).toBe(false);
  });

  test("collectSourceFilesRecursively traversal, depth limit, and ignored dirs", async () => {
    const root = await createVirtualDir("collect-cov");
    expect(collectSourceFilesRecursively("/non-existent-dir")).toEqual([]);
    expect(collectSourceFilesRecursively(root, 1, 2)).toEqual([]);

    for (const d of ["node_modules/sub", ".git", "dist", "build", "coverage", "src/nested"]) {
      await mkdir(join(root, d), { recursive: true });
    }
    await writeFile(join(root, "node_modules/sub/pkg.ts"), "export const a = 1;");
    await writeFile(join(root, ".git/hook.ts"), "export const b = 2;");
    await writeFile(join(root, "dist/out.ts"), "export const c = 3;");
    await writeFile(join(root, "build/build.ts"), "export const d = 4;");
    await writeFile(join(root, "coverage/cov.ts"), "export const e = 5;");
    await writeFile(join(root, "src/nested/valid.ts"), "export const ok = true;");
    await writeFile(join(root, "src/nested/doc.txt"), "readme");

    expect(collectSourceFilesRecursively(root).length).toBe(1);

    const spy = spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("fs error");
    });
    expect(collectSourceFilesRecursively(root)).toEqual([]);
    spy.mockRestore();
  });

  test("readRunTasks and resolveTargetFiles with various task configurations", async () => {
    const root = await createVirtualDir("resolve-cov");
    const runRoot = initRun(root, "task-cov-run", new TextEncoder().encode("prompt"), "file", true);
    const file1 = join(root, "file1.ts"),
      file2 = join(root, "file2.tsx"),
      subDir = join(root, "sub");
    await mkdir(subDir, { recursive: true });
    await writeFile(file1, "export const f1 = 1;");
    await writeFile(file2, "export const f2 = 2;");
    await writeFile(join(subDir, "nested.ts"), "export const n = 3;");

    transact(runRoot, "coordinator", "setup", {}, (draft) => {
      draft.tasks = {
        "task-1": {
          id: "task-1",
          status: "ready",
          target_files: [file1, "", null as unknown as string],
          write_scope: [subDir, join(root, "ghost.ts")],
        },
        "task-2": { id: "task-2", status: "ready", target_files: [file2], write_scope: [] },
      };
    });

    const tasks = readRunTasks(runRoot);
    expect(tasks["task-1"]).toBeDefined();
    expect(tasks["task-2"]).toBeDefined();
    expect(() => resolveTargetFiles({ taskId: "task-1" })).toThrow(HarnessError);
    expect(() => resolveTargetFiles({ runRoot: "  ", taskId: "task-1" })).toThrow(HarnessError);
    expect(() => resolveTargetFiles({ runRoot, taskId: "unknown-task" })).toThrow(HarnessError);
    expect(resolveTargetFiles({ runRoot, taskId: "task-1" }).length).toBe(3);
    expect(resolveTargetFiles({ runRoot }).length).toBe(4);
    expect(resolveTargetFiles({ fileFlags: [subDir, file1, `${file1}, ${file2},  `] }).length).toBe(
      3,
    );
    expect(resolveTargetFiles({})).toEqual([]);

    transact(runRoot, "coordinator", "bad-tasks", {}, (draft) => {
      draft.tasks = "invalid" as unknown as Record<string, unknown>;
    });
    expect(typeof readRunTasks(runRoot)).toBe("object");
  });

  test("performAstLintCheck handles empty, clean, violation, and exception cases", async () => {
    expect(performAstLintCheck([]).passed).toBe(true);
    const root = await createVirtualDir("ast-lint-cov");
    const cleanFile = join(root, "clean.ts");
    await writeFile(cleanFile, "export const cleanVal = 100;\n");
    expect(performAstLintCheck([cleanFile]).passed).toBe(true);

    const violFile = join(root, "viol.ts");
    await writeFile(
      violFile,
      "export const x: any = 10;\nexport const y: any = 20;\n// @ts-ignore\nconst z = 30;\n",
    );
    const violRes = performAstLintCheck([violFile]);
    expect(violRes.passed).toBe(false);
    expect(violRes.summaryByRule["any_type"]).toBe(2);

    const spyCrash = spyOn(astLinter, "lintFile").mockImplementation(() => {
      throw new Error("mock crash");
    });
    const crashRes = performAstLintCheck([cleanFile]);
    expect(crashRes.passed).toBe(false);
    expect(crashRes.violations.some((v) => v.message.includes("Failed to lint file"))).toBe(true);
    spyCrash.mockRestore();
  });
});
