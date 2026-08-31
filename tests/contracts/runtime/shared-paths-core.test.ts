import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
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

export const sharedPathsCoreSuiteName = "core shared/paths: environment detection, repo root discovery, capsule confinement";

describe(sharedPathsCoreSuiteName, () => {
  const scratchBase = join(tmpdir(), `shared-paths-core-tests-${Date.now()}`);

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
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
    const root = join(scratchBase, "find-root");
    const sub1 = join(root, "level1");
    const sub2 = join(sub1, "level2");
    mkdirSync(sub2, { recursive: true });

    // With package.json
    writeFileSync(join(root, "package.json"), "{}", "utf-8");
    expect(findRepoRoot(sub2)).toBe(resolve(root));

    // With .git
    const gitRoot = join(scratchBase, "git-root");
    const gitSub = join(gitRoot, "a", "b");
    mkdirSync(join(gitRoot, ".git"), { recursive: true });
    mkdirSync(gitSub, { recursive: true });
    expect(findRepoRoot(gitSub)).toBe(resolve(gitRoot));

    // With .olt
    const oltRoot = join(scratchBase, "olt-root");
    const oltSub = join(oltRoot, "x", "y");
    mkdirSync(join(oltRoot, OLT_DIR_NAME), { recursive: true });
    mkdirSync(oltSub, { recursive: true });
    expect(findRepoRoot(oltSub)).toBe(resolve(oltRoot));

    expect(() => findRepoRoot("/")).toThrow(/no repository anchor/);

    const oltCapsuleMatrixRoot = join(scratchBase, "olt-capsule-matrix-repo");
    mkdirSync(join(oltCapsuleMatrixRoot, ".olt", "capsules", "run-123", "task-1"), {
      recursive: true,
    });
    writeFileSync(join(oltCapsuleMatrixRoot, "package.json"), "{}", "utf-8");
    expect(findRepoRoot(join(oltCapsuleMatrixRoot, ".olt", "capsules", "run-123", "task-1"))).toBe(
      resolve(oltCapsuleMatrixRoot),
    );

    const dotCapsuleMatrixRoot = join(scratchBase, "dot-capsule-matrix-repo");
    mkdirSync(join(dotCapsuleMatrixRoot, ".capsules", "run-123", "task-1"), { recursive: true });
    writeFileSync(join(dotCapsuleMatrixRoot, "package.json"), "{}", "utf-8");
    expect(findRepoRoot(join(dotCapsuleMatrixRoot, ".capsules", "run-123", "task-1"))).toBe(
      resolve(dotCapsuleMatrixRoot),
    );

    const testRepo = join(scratchBase, "sovereign-repo");
    const testCapsule = join(testRepo, ".olt", "capsules", "run-nested");
    const inCapsuleOlt = join(testCapsule, ".olt");
    const inCapsuleWorkspace = join(testCapsule, "workspace");
    mkdirSync(inCapsuleOlt, { recursive: true });
    mkdirSync(inCapsuleWorkspace, { recursive: true });
    writeFileSync(join(testRepo, "package.json"), "{}", "utf-8");
    writeFileSync(join(inCapsuleWorkspace, "package.json"), "{}", "utf-8");

    expect(findRepoRoot(testCapsule)).toBe(resolve(testRepo));
    expect(findRepoRoot(inCapsuleOlt)).toBe(resolve(testRepo));
    expect(findRepoRoot(inCapsuleWorkspace)).toBe(resolve(testRepo));
    expect(findRepoRoot(join(inCapsuleWorkspace, "package.json"))).toBe(resolve(testRepo));

    const worktreeRoot = join(scratchBase, "git-worktree");
    const worktreeSub = join(worktreeRoot, "sub", "dir");
    mkdirSync(worktreeSub, { recursive: true });
    writeFileSync(join(worktreeRoot, ".git"), "gitdir: /fake/main/.git/worktrees/wt\n", "utf-8");
    expect(findRepoRoot(worktreeSub)).toBe(resolve(worktreeRoot));

    const normalCapsulesRoot = join(scratchBase, "normal-repo");
    const normalCapsulesSub = join(normalCapsulesRoot, "src", "capsules");
    mkdirSync(normalCapsulesSub, { recursive: true });
    writeFileSync(join(normalCapsulesRoot, "package.json"), "{}", "utf-8");
    expect(findRepoRoot(normalCapsulesSub)).toBe(resolve(normalCapsulesRoot));

    rmSync(root, { recursive: true, force: true });
    rmSync(gitRoot, { recursive: true, force: true });
    rmSync(oltRoot, { recursive: true, force: true });
    rmSync(testRepo, { recursive: true, force: true });
    rmSync(worktreeRoot, { recursive: true, force: true });
    rmSync(normalCapsulesRoot, { recursive: true, force: true });
    rmSync(oltCapsuleMatrixRoot, { recursive: true, force: true });
    rmSync(dotCapsuleMatrixRoot, { recursive: true, force: true });
  });
});
