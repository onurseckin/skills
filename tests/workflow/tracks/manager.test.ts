import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";
import {
  cleanupTrackWorktree,
  createTrackWorktree,
  destroyTrackWorktree,
  listTrackWorktrees,
} from "../../../olt/scripts/src/workflow/worktree/index.ts";
import {
  cleanupVirtualTracksFS,
  getVirtualTracksFS,
  setupVirtualTracksFS,
} from "./tracks-fixture.ts";

const TEST_DIR = "/virtual/worktree-mgr-repo";

describe("track worktree manager (in-memory virtualization)", () => {
  beforeEach(() => {
    const vfs = setupVirtualTracksFS();
    vfs.mkdirSync(TEST_DIR, { recursive: true });
    vfs.mkdirSync(join(TEST_DIR, ".olt", "worktrees"), { recursive: true });
    vfs.mkdirSync(join(TEST_DIR, ".olt", "worktrees", "locks"), { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualTracksFS();
  });

  test("createTrackWorktree creates worktree and acquires lock", () => {
    const vfs = getVirtualTracksFS();
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "rev-parse") return { status: 1, stdout: "", stderr: "" };
      if (argv[0] === "worktree" && argv[1] === "add") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const record = createTrackWorktree({
      trackId: "track-alpha",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(record.trackId).toBe("track-alpha");
    expect(record.branch).toBe("track/track-alpha");
    expect(record.baseBranch).toBe("main");
    expect(record.worktreePath).toBe(join(TEST_DIR, ".olt", "worktrees", "track-alpha"));
    expect(record.lockPath).toBe(join(TEST_DIR, ".olt", "worktrees", "locks", "track-alpha.lock"));
    expect(vfs.existsSync(record.lockPath)).toBe(true);

    const lockContent = JSON.parse(vfs.readFileSync(record.lockPath, "utf8"));
    expect(lockContent.trackId).toBe("track-alpha");
    expect(lockContent.pid).toBe(process.pid);
  });

  test("createTrackWorktree throws INVALID_ARGUMENT when trackId is missing or invalid", () => {
    expect(() => createTrackWorktree({ trackId: "", repoRoot: TEST_DIR })).toThrow(HarnessError);
  });

  test("createTrackWorktree fails and cleans lock on git error", () => {
    const vfs = getVirtualTracksFS();
    const failingRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree") {
        return { status: 128, stdout: "", stderr: "fatal: branch already exists" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      createTrackWorktree({
        trackId: "track-err",
        repoRoot: TEST_DIR,
        runner: failingRunner,
      }),
    ).toThrow(HarnessError);

    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "track-err.lock");
    expect(vfs.existsSync(lockPath)).toBe(false);
  });

  test("cleanupTrackWorktree removes worktree directory, branch and lock", () => {
    const vfs = getVirtualTracksFS();
    const executedGit: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executedGit.push([...argv]);
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-beta");
    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "track-beta.lock");
    vfs.mkdirSync(worktreeDir, { recursive: true });
    vfs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, trackId: "track-beta" }));

    const result = cleanupTrackWorktree({
      trackId: "track-beta",
      repoRoot: TEST_DIR,
      force: true,
      runner: mockRunner,
    });

    expect(result.trackId).toBe("track-beta");
    expect(result.cleaned).toBe(true);
    expect(vfs.existsSync(lockPath)).toBe(false);

    expect(executedGit.some((args) => args[0] === "worktree" && args[1] === "remove")).toBe(true);
    expect(executedGit.some((args) => args[0] === "branch" && args[1] === "-D")).toBe(true);
    expect(executedGit.some((args) => args[0] === "worktree" && args[1] === "prune")).toBe(true);
  });

  test("listTrackWorktrees reads worktree metadata from disk", () => {
    const vfs = getVirtualTracksFS();
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-1");
    vfs.mkdirSync(worktreeDir, { recursive: true });
    const metaPath = join(worktreeDir, ".worktree-meta.json");
    vfs.writeFileSync(
      metaPath,
      JSON.stringify({
        trackId: "track-1",
        worktreePath: worktreeDir,
        branch: "track/track-1",
        baseBranch: "main",
        lockPath: join(TEST_DIR, ".olt", "worktrees", "locks", "track-1.lock"),
        createdAt: new Date().toISOString(),
        status: "active",
      }),
    );

    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list") {
        return {
          status: 0,
          stdout: `worktree ${worktreeDir}\nHEAD 111\nbranch refs/heads/track/track-1\n`,
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const list = listTrackWorktrees({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(list.length).toBe(1);
    expect(list[0]!.trackId).toBe("track-1");
  });

  test("createTrackWorktree accepts string trackId and returns path", () => {
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "rev-parse") return { status: 1, stdout: "", stderr: "" };
      if (argv[0] === "worktree" && argv[1] === "add") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreePath = createTrackWorktree({
      trackId: "track-gamma",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });
    expect(worktreePath.trackId).toBe("track-gamma");
    expect(worktreePath.worktreePath).toBe(join(TEST_DIR, ".olt", "worktrees", "track-gamma"));
  });

  test("destroyTrackWorktree with options cleans worktree and lock", () => {
    const vfs = getVirtualTracksFS();
    const executedGit: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executedGit.push([...argv]);
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-delta");
    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "track-delta.lock");
    vfs.mkdirSync(worktreeDir, { recursive: true });
    vfs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, trackId: "track-delta" }));

    const result = destroyTrackWorktree({
      trackId: "track-delta",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(result.trackId).toBe("track-delta");
    expect(result.cleaned).toBe(true);
    expect(vfs.existsSync(lockPath)).toBe(false);
    expect(executedGit.some((args) => args[0] === "worktree" && args[1] === "prune")).toBe(true);
  });
});
