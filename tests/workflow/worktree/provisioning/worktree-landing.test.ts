import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { GitRunner } from "../../../../olt/scripts/src/workflow/worktree/git.ts";
import {
  cleanupTrackWorktree,
  createTrackWorktree,
  destroyTrackWorktree,
  landTrackToMain,
  listTrackWorktrees,
} from "../../../../olt/scripts/src/workflow/worktree/index.ts";

const TEST_DIR = join(process.cwd(), ".olt", "scratch", "test-worktree-suite");

describe("Worktree Manager & Landing", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
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
