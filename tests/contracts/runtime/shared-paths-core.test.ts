import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import {
  findRepoRoot,
  isInsideCapsule,
  isTestEnvironment,
  OLT_DIR_NAME,
  resolveBacklogPath,
  resolveCompletedDefectsPath,
  resolveCompletedTasksPath,
  resolveDefectsPath,
  resolveMemoryPath,
  resolveTelemetryPath,
  resolveWatchdogsPath,
  stripCapsulePath,
} from "../../../olt/scripts/src/core/shared/paths.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../../reporting/browser/browser-virtual-fs.ts";

export const sharedPathsCoreSuiteName =
  "core shared/paths: environment detection, repo root discovery, capsule confinement";

describe(sharedPathsCoreSuiteName, () => {
  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
  });

  test("isTestEnvironment correctly identifies test runtime and argv branches", () => {
    expect(isTestEnvironment()).toBe(true);

    const oldNodeEnv = process.env["NODE_ENV"];
    const oldBunTest = process.env["BUN_TEST"];
    const oldTest = process.env["TEST"];
    const oldArgv = [...process.argv];

    try {
      delete process.env["NODE_ENV"];
      delete process.env["BUN_TEST"];
      delete process.env["TEST"];

      process.argv = ["bun", "run", "test:unit"];
      expect(isTestEnvironment()).toBe(true);

      process.argv = ["bun", "run", "bun:test"];
      expect(isTestEnvironment()).toBe(true);

      process.argv = ["bun", "run", "serve.ts"];
      expect(isTestEnvironment()).toBe(false);

      process.argv = null as unknown as string[];
      expect(isTestEnvironment()).toBe(false);
    } finally {
      if (oldNodeEnv !== undefined) process.env["NODE_ENV"] = oldNodeEnv;
      if (oldBunTest !== undefined) process.env["BUN_TEST"] = oldBunTest;
      if (oldTest !== undefined) process.env["TEST"] = oldTest;
      process.argv = oldArgv;
    }
  });

  test("resolveSafeRoot handles findRepoRoot when isTestEnvironment is active", () => {
    const root = findRepoRoot();
    expect(resolveBacklogPath(root)).toContain("olt-scratch");
    expect(resolveCompletedTasksPath(root)).toContain("olt-scratch");
    expect(resolveDefectsPath(root)).toContain("olt-scratch");
    expect(resolveCompletedDefectsPath(root)).toContain("olt-scratch");
    expect(resolveTelemetryPath(root)).toContain("olt-scratch");
    expect(resolveMemoryPath(root)).toContain("olt-scratch");
    expect(resolveWatchdogsPath(root)).toContain("olt-scratch");
  });

  test("isInsideCapsule correctly identifies capsule paths and ignores normal capsule-named subfolders", () => {
    expect(isInsideCapsule("/repo/.olt/capsules/run-101")).toBe(true);
    expect(isInsideCapsule("/repo/.olt/capsules/run-101/workspace/deep")).toBe(true);
    expect(isInsideCapsule("/repo/.olt/capsules")).toBe(true);
    expect(isInsideCapsule("/repo/.capsules/run-202")).toBe(true);
    expect(isInsideCapsule("/repo/.capsules")).toBe(true);

    // Negative cases
    expect(isInsideCapsule("/repo/src/core/paths.ts")).toBe(false);
    expect(isInsideCapsule("/repo/src/capsules/module.ts")).toBe(false);
    expect(isInsideCapsule("/repo/packages/capsules-lib/index.ts")).toBe(false);
  });

  test("stripCapsulePath cleanly extracts enclosing sovereign repo root prefix", () => {
    expect(stripCapsulePath("/repo/.olt/capsules/run-101")).toBe(resolve("/repo"));
    expect(stripCapsulePath("/repo/.olt/capsules/run-101/sub/dir")).toBe(resolve("/repo"));
    expect(stripCapsulePath("/repo/.capsules/run-202/task")).toBe(resolve("/repo"));
    expect(stripCapsulePath("/repo/src/core/paths.ts")).toBeUndefined();
  });

  test("findRepoRoot discovers repo root upward across .olt, .git, and package.json markers", () => {
    const root = tempDir("find-root");
    const sub1 = join(root, "level1");
    const sub2 = join(sub1, "level2");
    fs.mkdirSync(sub2, { recursive: true });

    // With package.json
    fs.writeFileSync(join(root, "package.json"), "{}", "utf-8");
    expect(findRepoRoot(sub2)).toBe(resolve(root));

    // With .git
    const gitRoot = tempDir("git-root");
    const gitSub = join(gitRoot, "a", "b");
    fs.mkdirSync(join(gitRoot, ".git"), { recursive: true });
    fs.mkdirSync(gitSub, { recursive: true });
    expect(findRepoRoot(gitSub)).toBe(resolve(gitRoot));

    // With .olt
    const oltRoot = tempDir("olt-root");
    const oltSub = join(oltRoot, "x", "y");
    fs.mkdirSync(join(oltRoot, OLT_DIR_NAME), { recursive: true });
    fs.mkdirSync(oltSub, { recursive: true });
    expect(findRepoRoot(oltSub)).toBe(resolve(oltRoot));

    expect(() => findRepoRoot("/")).toThrow(/no repository anchor/);

    const oltCapsuleMatrixRoot = tempDir("olt-capsule-matrix-repo");
    fs.mkdirSync(join(oltCapsuleMatrixRoot, ".olt", "capsules", "run-123", "task-1"), {
      recursive: true,
    });
    fs.writeFileSync(join(oltCapsuleMatrixRoot, "package.json"), "{}", "utf-8");
    expect(findRepoRoot(join(oltCapsuleMatrixRoot, ".olt", "capsules", "run-123", "task-1"))).toBe(
      resolve(oltCapsuleMatrixRoot),
    );

    const dotCapsuleMatrixRoot = tempDir("dot-capsule-matrix-repo");
    fs.mkdirSync(join(dotCapsuleMatrixRoot, ".capsules", "run-123", "task-1"), { recursive: true });
    fs.writeFileSync(join(dotCapsuleMatrixRoot, "package.json"), "{}", "utf-8");
    expect(findRepoRoot(join(dotCapsuleMatrixRoot, ".capsules", "run-123", "task-1"))).toBe(
      resolve(dotCapsuleMatrixRoot),
    );

    const testRepo = tempDir("sovereign-repo");
    const testCapsule = join(testRepo, ".olt", "capsules", "run-nested");
    const inCapsuleOlt = join(testCapsule, ".olt");
    const inCapsuleWorkspace = join(testCapsule, "workspace");
    fs.mkdirSync(inCapsuleOlt, { recursive: true });
    fs.mkdirSync(inCapsuleWorkspace, { recursive: true });
    fs.writeFileSync(join(testRepo, "package.json"), "{}", "utf-8");
    fs.writeFileSync(join(inCapsuleWorkspace, "package.json"), "{}", "utf-8");

    expect(findRepoRoot(testCapsule)).toBe(resolve(testRepo));
    expect(findRepoRoot(inCapsuleOlt)).toBe(resolve(testRepo));
    expect(findRepoRoot(inCapsuleWorkspace)).toBe(resolve(testRepo));
    expect(findRepoRoot(join(inCapsuleWorkspace, "package.json"))).toBe(resolve(testRepo));

    const worktreeRoot = tempDir("git-worktree");
    const worktreeSub = join(worktreeRoot, "sub", "dir");
    fs.mkdirSync(worktreeSub, { recursive: true });
    fs.writeFileSync(join(worktreeRoot, ".git"), "gitdir: /fake/main/.git/worktrees/wt\n", "utf-8");
    expect(findRepoRoot(worktreeSub)).toBe(resolve(worktreeRoot));

    const normalCapsulesRoot = tempDir("normal-repo");
    const normalCapsulesSub = join(normalCapsulesRoot, "src", "capsules");
    fs.mkdirSync(normalCapsulesSub, { recursive: true });
    fs.writeFileSync(join(normalCapsulesRoot, "package.json"), "{}", "utf-8");
    expect(findRepoRoot(normalCapsulesSub)).toBe(resolve(normalCapsulesRoot));
  });
});
