import { describe, expect, test, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findRepoRoot,
  isInsideCapsule,
  isTestEnvironment,
  OLT_DIR_NAME,
  OLT_FILES,
  resolveBacklogPath,
  resolveCapsulesDir,
  resolveCompletedDefectsPath,
  resolveCompletedTasksPath,
  resolveDefectsPath,
  resolveEvidenceDir,
  resolveMemoryPath,
  resolveOltDir,
  resolvePolicyPath,
  resolveScratchDir,
  resolveTelemetryPath,
  resolveWatchdogsPath,
  stripCapsulePath,
} from "../../../olt/scripts/src/core/shared/paths.ts";

describe("core shared/paths contract and resolution", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "shared-paths-tests");

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

      // With test in argv
      process.argv = ["bun", "run", "test:unit"];
      expect(isTestEnvironment()).toBe(true);

      process.argv = ["bun", "run", "bun:test"];
      expect(isTestEnvironment()).toBe(true);

      // With non-test in argv
      process.argv = ["bun", "run", "serve.ts"];
      expect(isTestEnvironment()).toBe(false);

      // With non-array argv
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

    // Root-level termination fallback
    expect(findRepoRoot("/")).toBe(resolve("/"));

    // Capsule subfolder heuristics (Matrix rows 1-6)
    expect(findRepoRoot("/fake/repo/.olt/capsules/run-123/task-1")).toBe(resolve("/fake/repo"));
    expect(findRepoRoot("/fake/repo/.capsules/run-123/task-1")).toBe(resolve("/fake/repo"));

    // In-capsule markers do not trick findRepoRoot into anchoring inside the capsule (Matrix rows 3, 4, 5)
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

    // Git worktree (.git is a regular file) (Matrix row 7)
    const worktreeRoot = join(scratchBase, "git-worktree");
    const worktreeSub = join(worktreeRoot, "sub", "dir");
    mkdirSync(worktreeSub, { recursive: true });
    writeFileSync(join(worktreeRoot, ".git"), "gitdir: /fake/main/.git/worktrees/wt\n", "utf-8");
    expect(findRepoRoot(worktreeSub)).toBe(resolve(worktreeRoot));

    // Normal folder named capsules (Matrix row 8)
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
  });

  test("resolveCapsulesDir and resolveOltDir are idempotent and never double-nest (Matrix rows 9-10)", () => {
    const base = resolve("/fake/repo");
    expect(resolveCapsulesDir(base)).toBe(join(base, ".olt", "capsules"));
    expect(resolveCapsulesDir(join(base, ".olt"))).toBe(join(base, ".olt", "capsules"));
    expect(resolveCapsulesDir(join(base, ".olt", "capsules"))).toBe(join(base, ".olt", "capsules"));

    expect(resolveOltDir(base)).toBe(join(base, ".olt"));
    expect(resolveOltDir(join(base, ".olt"))).toBe(join(base, ".olt"));
  });

  test("resolveScratchDir creates predictable process-isolated scratch paths", () => {
    const scratch = resolveScratchDir();
    expect(scratch).toContain("olt-scratch");
    expect(scratch).toContain(String(process.pid));
  });

  test("resolves all canonical OLT file and directory paths with and without custom overrides", () => {
    const customRepo = join(scratchBase, "custom-repo");
    mkdirSync(customRepo, { recursive: true });

    expect(resolveOltDir(customRepo)).toBe(join(customRepo, OLT_DIR_NAME));
    expect(resolveOltDir()).toBe(join(findRepoRoot(), OLT_DIR_NAME));

    expect(resolveCapsulesDir(customRepo)).toBe(join(customRepo, OLT_DIR_NAME, "capsules"));
    expect(resolveCapsulesDir()).toBe(join(findRepoRoot(), OLT_DIR_NAME, "capsules"));

    // Policy path
    expect(resolvePolicyPath(customRepo)).toBe(join(customRepo, OLT_DIR_NAME, OLT_FILES.POLICY));
    expect(resolvePolicyPath(customRepo, "/custom/path/policy.json")).toBe(
      resolve("/custom/path/policy.json"),
    );

    // Backlog path
    expect(resolveBacklogPath(customRepo, "/custom/backlog.jsonl")).toBe(
      resolve("/custom/backlog.jsonl"),
    );
    expect(resolveBacklogPath(customRepo)).toContain(OLT_FILES.BACKLOG);
    expect(resolveBacklogPath()).toContain(OLT_FILES.BACKLOG);

    // Completed tasks path
    expect(resolveCompletedTasksPath(customRepo, "/custom/tasks.jsonl")).toBe(
      resolve("/custom/tasks.jsonl"),
    );
    expect(resolveCompletedTasksPath(customRepo)).toContain(OLT_FILES.COMPLETED_TASKS);
    expect(resolveCompletedTasksPath()).toContain(OLT_FILES.COMPLETED_TASKS);

    // Defects path
    expect(resolveDefectsPath(customRepo, "/custom/defects.jsonl")).toBe(
      resolve("/custom/defects.jsonl"),
    );
    expect(resolveDefectsPath(customRepo)).toContain(OLT_FILES.DEFECTS);
    expect(resolveDefectsPath()).toContain(OLT_FILES.DEFECTS);

    // Completed defects path
    expect(resolveCompletedDefectsPath(customRepo, "/custom/completed-defects.jsonl")).toBe(
      resolve("/custom/completed-defects.jsonl"),
    );
    expect(resolveCompletedDefectsPath(customRepo)).toContain(OLT_FILES.COMPLETED_DEFECTS);
    expect(resolveCompletedDefectsPath()).toContain(OLT_FILES.COMPLETED_DEFECTS);

    // Telemetry path
    expect(resolveTelemetryPath(customRepo, "/custom/telemetry.jsonl")).toBe(
      resolve("/custom/telemetry.jsonl"),
    );
    expect(resolveTelemetryPath(customRepo)).toContain(OLT_FILES.TELEMETRY);
    expect(resolveTelemetryPath()).toContain(OLT_FILES.TELEMETRY);

    // Memory path
    expect(resolveMemoryPath(customRepo, "/custom/memory.json")).toBe(
      resolve("/custom/memory.json"),
    );
    expect(resolveMemoryPath(customRepo)).toContain(OLT_FILES.MEMORY);
    expect(resolveMemoryPath()).toContain(OLT_FILES.MEMORY);

    // Watchdogs path
    expect(resolveWatchdogsPath(customRepo, "/custom/watchdogs.json")).toBe(
      resolve("/custom/watchdogs.json"),
    );
    expect(resolveWatchdogsPath(customRepo)).toContain(OLT_FILES.WATCHDOGS);
    expect(resolveWatchdogsPath()).toContain(OLT_FILES.WATCHDOGS);

    // Evidence directory resolution
    const runRoot = join(scratchBase, "active-run");
    mkdirSync(runRoot, { recursive: true });
    expect(resolveEvidenceDir(customRepo, runRoot)).toBe(join(runRoot, "evidence"));
    expect(resolveEvidenceDir(customRepo, join(scratchBase, "nonexistent-run"))).toContain(
      "evidence",
    );
    expect(resolveEvidenceDir()).toContain("evidence");

    rmSync(customRepo, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  });
});
