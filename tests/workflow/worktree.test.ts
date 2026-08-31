import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import type { GitRunner } from "../../olt/scripts/src/workflow/worktree/git.ts";
import {
  cleanupTrackWorktree,
  createTrackWorktree,
  destroyTrackWorktree,
  landTrackToMain,
  listTrackWorktrees,
} from "../../olt/scripts/src/workflow/worktree/index.ts";

const TEST_DIR = join(process.cwd(), ".olt", "scratch", "test-worktree-suite");

describe("Worktree Manager & Landing", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("provisions hermetic worktree and acquires track lock", () => {
    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executed.push([...argv]);
      return { status: 0, stdout: "", stderr: "" };
    };

    const record = createTrackWorktree({
      trackId: "track-prov-1",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(record.trackId).toBe("track-prov-1");
    expect(record.branch).toBe("track/track-prov-1");
    expect(record.status).toBe("active");
    expect(existsSync(record.worktreePath)).toBe(true);
    expect(existsSync(record.lockPath)).toBe(true);

    const metaPath = join(record.worktreePath, ".worktree-meta.json");
    expect(existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    expect(meta.trackId).toBe("track-prov-1");

    expect(executed.some((c) => c[0] === "worktree" && c[1] === "add")).toBe(true);
  });

  test("createTrackWorktree supports string shorthand", () => {
    const defaultWorktreeRoot = join(TEST_DIR, ".olt", "worktrees");
    mkdirSync(defaultWorktreeRoot, { recursive: true });
    const mockRunner: GitRunner = (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" });

    const wtPath = createTrackWorktree({
      trackId: "track-short",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });
    expect(wtPath.trackId).toBe("track-short");
  });

  test("validates trackId format and throws INVALID_ARGUMENT", () => {
    expect(() => createTrackWorktree({ trackId: "", repoRoot: TEST_DIR })).toThrow(HarnessError);
    expect(() => createTrackWorktree({ trackId: "bad/path", repoRoot: TEST_DIR })).toThrow(
      HarnessError,
    );
    expect(() => createTrackWorktree({ trackId: "bad spaces", repoRoot: TEST_DIR })).toThrow(
      HarnessError,
    );
  });

  test("enforces hermetic isolation across multiple concurrent tracks", () => {
    const mockRunner: GitRunner = (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" });

    const track1 = createTrackWorktree({
      trackId: "track-alpha",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    const track2 = createTrackWorktree({
      trackId: "track-beta",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(track1.worktreePath).not.toBe(track2.worktreePath);
    expect(track1.branch).toBe("track/track-alpha");
    expect(track2.branch).toBe("track/track-beta");
    expect(track1.lockPath).not.toBe(track2.lockPath);

    const activeList = listTrackWorktrees({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(activeList.length).toBe(2);
    expect(activeList.some((t) => t.trackId === "track-alpha")).toBe(true);
    expect(activeList.some((t) => t.trackId === "track-beta")).toBe(true);
  });

  test("evicts stale locks with dead PIDs or corrupted JSON", () => {
    const lockDir = join(TEST_DIR, ".olt", "worktrees", "locks");
    mkdirSync(lockDir, { recursive: true });

    // 1. Dead PID lock
    const deadLockPath = join(lockDir, "track-dead.lock");
    writeFileSync(
      deadLockPath,
      JSON.stringify({
        trackId: "track-dead",
        pid: 999999999,
        createdAt: new Date().toISOString(),
      }),
    );

    const mockRunner: GitRunner = (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" });
    const res1 = createTrackWorktree({
      trackId: "track-dead",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });
    expect(res1.trackId).toBe("track-dead");

    // 2. Corrupted JSON lock
    destroyTrackWorktree({ trackId: "track-dead", repoRoot: TEST_DIR, runner: mockRunner });
    const corruptLockPath = join(lockDir, "track-corrupt.lock");
    writeFileSync(corruptLockPath, "invalid json content");
    const res2 = createTrackWorktree({
      trackId: "track-corrupt",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });
    expect(res2.trackId).toBe("track-corrupt");
  });

  test("throws LOCK_TIMEOUT when lock is held by living process beyond timeout", () => {
    const lockDir = join(TEST_DIR, ".olt", "worktrees", "locks");
    mkdirSync(lockDir, { recursive: true });
    const lockPath = join(lockDir, "track-locked.lock");
    // Write lock with current living PID
    writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "track-locked",
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }),
    );

    expect(() =>
      createTrackWorktree({
        trackId: "track-locked",
        repoRoot: TEST_DIR,
        lockTimeoutMs: 50,
      }),
    ).toThrow(/could not be acquired within 50ms/);
  });

  test("destroyTrackWorktree safely removes directory and releases lock on git error", () => {
    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executed.push([...argv]);
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-teardown");
    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "track-teardown.lock");
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(join(TEST_DIR, ".olt", "worktrees", "locks"), { recursive: true });
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, trackId: "track-teardown" }),
      "utf8",
    );

    const result = destroyTrackWorktree({
      trackId: "track-teardown",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(result.cleaned).toBe(true);
    expect(result.trackId).toBe("track-teardown");
    expect(existsSync(worktreeDir)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
    expect(executed.some((c) => c[0] === "worktree" && c[1] === "prune")).toBe(true);
  });

  test("destroyTrackWorktree handles git remove failure by falling back to safeRmSync", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-git-fail");
    mkdirSync(worktreeDir, { recursive: true });

    const failingRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "remove")
        throw new Error("git worktree remove failed");
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = destroyTrackWorktree({
      trackId: "track-git-fail",
      repoRoot: TEST_DIR,
      runner: failingRunner,
    });
    expect(result.cleaned).toBe(true);
    expect(existsSync(worktreeDir)).toBe(false);
  });

  test("destroyTrackWorktree string overload executes and returns void", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-str-destroy");
    mkdirSync(worktreeDir, { recursive: true });

    destroyTrackWorktree({
      trackId: "track-str-destroy",
      repoRoot: TEST_DIR,
      runner: () => ({ status: 0, stdout: "", stderr: "" }),
    });
    expect(existsSync(worktreeDir)).toBe(false);
  });

  test("listTrackWorktrees handles missing worktree root and corrupt meta files", () => {
    // 1. Missing root
    const missingRoot = join(TEST_DIR, "nonexistent-repo");
    expect(listTrackWorktrees({ repoRoot: missingRoot })).toEqual([]);

    // 2. Existing root with corrupt meta file
    const wtDir = join(TEST_DIR, ".olt", "worktrees", "track-corrupt-meta");
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(join(wtDir, ".worktree-meta.json"), "invalid json");

    const list = listTrackWorktrees({ repoRoot: TEST_DIR });
    expect(list.length).toBe(1);
    expect(list[0].trackId).toBe("track-corrupt-meta");
    expect(list[0].branch).toBe("track/track-corrupt-meta");
  });

  test("cleanupTrackWorktree alias performs identical teardown", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-clean-alias");
    mkdirSync(worktreeDir, { recursive: true });

    const result = cleanupTrackWorktree({
      trackId: "track-clean-alias",
      repoRoot: TEST_DIR,
      runner: (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" }),
    });

    expect(result.cleaned).toBe(true);
    expect(existsSync(worktreeDir)).toBe(false);
  });

  test("createTrackWorktree attaches existing branch if already present", () => {
    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executed.push([...argv]);
      if (argv[0] === "rev-parse" && argv.includes("refs/heads/track/track-existing")) {
        return { status: 0, stdout: "abc\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const record = createTrackWorktree({
      trackId: "track-existing",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(record.trackId).toBe("track-existing");
    expect(executed.some((c) => c[0] === "worktree" && c[1] === "add" && !c.includes("-b"))).toBe(
      true,
    );
  });

  test("evicts stale lock when lock timestamp is older than STALE_LOCK_THRESHOLD even if PID matches", () => {
    const lockDir = join(TEST_DIR, ".olt", "worktrees", "locks");
    mkdirSync(lockDir, { recursive: true });
    const lockPath = join(lockDir, "track-expired.lock");
    // Write lock with living PID but 2 hours ago
    const oldDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "track-expired",
        pid: process.pid,
        createdAt: oldDate,
      }),
    );

    const mockRunner: GitRunner = (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" });
    const res = createTrackWorktree({
      trackId: "track-expired",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });
    expect(res.trackId).toBe("track-expired");
  });

  test("landTrackToMain uses fast-forward CAS verification when advancing non-active target branch", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-land-cas");
    mkdirSync(worktreeDir, { recursive: true });

    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executed.push([...argv]);
      if (argv[0] === "symbolic-ref") return { status: 0, stdout: "other-branch\n", stderr: "" };
      if (argv[0] === "rev-parse" && argv[1] === "HEAD")
        return { status: 0, stdout: "commit-sha-777\n", stderr: "" };
      if (argv[0] === "rev-parse" && argv.includes("refs/heads/main"))
        return { status: 0, stdout: "main\n", stderr: "" };
      if (argv[0] === "merge-base" && argv.includes("--is-ancestor"))
        return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = landTrackToMain({
      trackId: "track-land-cas",
      repoRoot: TEST_DIR,
      targetBranch: "main",
      runner: mockRunner,
    });

    expect(result.success).toBe(true);
    expect(result.commitSha).toBe("commit-sha-777");
    // Verify update-ref CAS advancement instead of branch -f
    expect(
      executed.some(
        (c) => c[0] === "update-ref" && c[1] === "refs/heads/main" && c[2] === "commit-sha-777",
      ),
    ).toBe(true);
  });

  test("landTrackToMain throws INTEGRITY when target branch advance is non-fast-forward", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-land-diverged");
    mkdirSync(worktreeDir, { recursive: true });

    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "symbolic-ref") return { status: 0, stdout: "other-branch\n", stderr: "" };
      if (argv[0] === "rev-parse" && argv[1] === "HEAD")
        return { status: 0, stdout: "commit-sha-888\n", stderr: "" };
      if (argv[0] === "rev-parse" && argv.includes("refs/heads/main"))
        return { status: 0, stdout: "main\n", stderr: "" };
      if (argv[0] === "merge-base" && argv.includes("--is-ancestor"))
        return { status: 1, stdout: "", stderr: "not ancestor" };
      return { status: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      landTrackToMain({
        trackId: "track-land-diverged",
        repoRoot: TEST_DIR,
        targetBranch: "main",
        runner: mockRunner,
      }),
    ).toThrow(/non-fast-forward update detected/);
  });

  test("landTrackToMain throws INTEGRITY when remote push fails", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-push-fail");
    mkdirSync(worktreeDir, { recursive: true });

    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "symbolic-ref") return { status: 0, stdout: "main\n", stderr: "" };
      if (argv[0] === "rev-parse" && argv[1] === "HEAD")
        return { status: 0, stdout: "commit-sha-999\n", stderr: "" };
      if (argv[0] === "merge") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "push")
        return { status: 1, stdout: "", stderr: "fatal: authentication failed" };
      return { status: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      landTrackToMain({
        trackId: "track-push-fail",
        repoRoot: TEST_DIR,
        targetBranch: "main",
        remote: "origin",
        runner: mockRunner,
      }),
    ).toThrow(/Failed to push 'main' to remote 'origin'/);
  });
});
