import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { GitRunner } from "../../../../olt/scripts/src/workflow/worktree/git.ts";
import { landTrackToMain } from "../../../../olt/scripts/src/workflow/worktree/index.ts";

const TEST_DIR = join(process.cwd(), ".olt", "scratch", "test-worktree-land");

describe("track worktree landing pipeline", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("landTrackToMain successfully rebases, pushes, writes telemetry and cleans up", () => {
    const executed: string[][] = [];
    const mockRunner: GitRunner = (cwd, argv) => {
      executed.push([...argv]);
      if (argv[0] === "fetch") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "rebase") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "rev-parse" && argv[1] === "HEAD")
        return { status: 0, stdout: "abc123def456\n", stderr: "" };
      if (argv[0] === "push") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "worktree") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "branch") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-landing-1");
    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "track-landing-1.lock");
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(join(TEST_DIR, ".olt", "worktrees", "locks"), { recursive: true });
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, trackId: "track-landing-1" }),
      "utf8",
    );

    let hookCalled = false;
    const result = landTrackToMain({
      trackId: "track-landing-1",
      repoRoot: TEST_DIR,
      remote: "origin",
      targetBranch: "main",
      runner: mockRunner,
      customHookExecutor: () => {
        hookCalled = true;
      },
    });

    expect(result.trackId).toBe("track-landing-1");
    expect(result.commitSha).toBe("abc123def456");
    expect(result.targetBranch).toBe("main");
    expect(result.pushed).toBe(true);
    expect(result.cleaned).toBe(true);
    expect(result.hookExecuted).toBe(true);
    expect(hookCalled).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const telemetryPath = join(TEST_DIR, ".olt", "telemetry.jsonl");
    expect(existsSync(telemetryPath)).toBe(true);
    const line = readFileSync(telemetryPath, "utf8").trim();
    const parsed = JSON.parse(line);
    expect(parsed.trackId).toBe("track-landing-1");
    expect(parsed.event).toBe("track_landed");
    expect(parsed.commitSha).toBe("abc123def456");

    expect(existsSync(lockPath)).toBe(false);
  });

  test("landTrackToMain handles local-only repository gracefully", () => {
    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "rev-parse" && argv[1] === "HEAD")
        return { status: 0, stdout: "localsha123\n", stderr: "" };
      if (argv[0] === "branch" && argv[1] === "-f") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-local");
    mkdirSync(worktreeDir, { recursive: true });

    const result = landTrackToMain({
      trackId: "track-local",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(result.pushed).toBe(false);
    expect(result.commitSha).toBe("localsha123");
    expect(result.cleaned).toBe(true);
  });

  test("landTrackToMain throws INVALID_STATE when worktree does not exist", () => {
    expect(() => landTrackToMain({ trackId: "missing-track", repoRoot: TEST_DIR })).toThrow(
      HarnessError,
    );
  });

  test("landTrackToMain handles activeBranch === targetBranch with fast-forward merge", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-ff");
    mkdirSync(worktreeDir, { recursive: true });

    const executed: string[][] = [];
    const mockRunner: GitRunner = (cwd, argv) => {
      executed.push([...argv]);
      if (argv[0] === "symbolic-ref") return { status: 0, stdout: "main\n", stderr: "" };
      if (argv[0] === "rev-parse" && argv[1] === "HEAD")
        return { status: 0, stdout: "sha-ff\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };


    const result = landTrackToMain({
      trackId: "track-ff",
      repoRoot: TEST_DIR,
      targetBranch: "main",
      runner: mockRunner,
      releaseHook: false,
    });

    expect(result.success).toBe(true);
    expect(executed.some((cmd) => cmd[0] === "merge" && cmd[1] === "--ff-only")).toBe(true);
    expect(result.hookExecuted).toBe(false);
  });

  test("landTrackToMain handles remote fetch failure and non-atomic push fallback", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-fallback");
    mkdirSync(worktreeDir, { recursive: true });

    let pushCount = 0;
    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "fetch") throw new Error("fetch offline");
      if (argv[0] === "rebase") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "rev-parse" && argv[1] === "HEAD")
        return { status: 0, stdout: "sha-fb\n", stderr: "" };
      if (argv[0] === "push") {
        pushCount += 1;
        if (argv[1] === "--atomic") throw new Error("atomic push unsupported");
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = landTrackToMain({
      trackId: "track-fallback",
      repoRoot: TEST_DIR,
      remote: "origin",
      targetBranch: "main",
      runner: mockRunner,
    });

    expect(result.success).toBe(true);
    expect(result.pushed).toBe(true);
    expect(pushCount).toBe(2); // atomic failed -> regular succeeded
  });

  test("landTrackToMain throws INTEGRITY when rebase encounters conflicts", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-conflict");
    mkdirSync(worktreeDir, { recursive: true });

    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "rebase")
        return { status: 1, stdout: "CONFLICT (content): Merge conflict in src/a.ts", stderr: "" };
      if (argv[0] === "diff") return { status: 0, stdout: "src/a.ts\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      landTrackToMain({
        trackId: "track-conflict",
        repoRoot: TEST_DIR,
        runner: mockRunner,
      }),
    ).toThrow(/Rebase onto target branch 'main' failed with conflicts: src\/a.ts/);
  });

  test("landTrackToMain string overload executes asynchronously", async () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-str");
    mkdirSync(worktreeDir, { recursive: true });

    // Calling with string parameter returns Promise<void>
    // In test environment, without git repo it will throw INVALID_STATE if worktree doesn't exist or fail gracefully
    await expect(landTrackToMain("track-str")).rejects.toBeDefined();
  });
});
