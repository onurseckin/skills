import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";
import {
  cleanupTrackWorktree,
  createTrackWorktree,
  destroyTrackWorktree,
  landTrackToMain,
  listTrackWorktrees,
} from "../../../olt/scripts/src/workflow/worktree/index.ts";

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

  test("landTrackToMain rebases onto origin/main, atomic pushes, and cleans up", () => {
    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executed.push([...argv]);
      if (argv[0] === "fetch") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "rebase") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "rev-parse" && argv[1] === "HEAD") {
        return { status: 0, stdout: "commit-sha-789\n", stderr: "" };
      }
      if (argv[0] === "push") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "worktree") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "branch") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-land-1");
    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "track-land-1.lock");
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(join(TEST_DIR, ".olt", "worktrees", "locks"), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, trackId: "track-land-1" }), "utf8");

    let customHookFired = false;
    const result = landTrackToMain({
      trackId: "track-land-1",
      repoRoot: TEST_DIR,
      remote: "origin",
      targetBranch: "main",
      runner: mockRunner,
      customHookExecutor: () => {
        customHookFired = true;
      },
    });

    expect(result.success).toBe(true);
    expect(result.trackId).toBe("track-land-1");
    expect(result.commitSha).toBe("commit-sha-789");
    expect(result.targetBranch).toBe("main");
    expect(result.rebased).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.cleaned).toBe(true);
    expect(result.tornDown).toBe(true);
    expect(result.hookExecuted).toBe(true);
    expect(customHookFired).toBe(true);

    const pushCalls = executed.filter((c) => c[0] === "push");
    expect(pushCalls.length).toBeGreaterThan(0);
    expect(pushCalls[0]).toContain("--atomic");

    const telemetryPath = join(TEST_DIR, ".olt", "telemetry.jsonl");
    expect(existsSync(telemetryPath)).toBe(true);
    const telemetry = JSON.parse(readFileSync(telemetryPath, "utf8").trim());
    expect(telemetry.event).toBe("track_landed");
    expect(telemetry.trackId).toBe("track-land-1");
    expect(telemetry.commitSha).toBe("commit-sha-789");

    expect(existsSync(lockPath)).toBe(false);
  });

  test("landTrackToMain with string parameter returns Promise<void>", async () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-str-1");
    mkdirSync(worktreeDir, { recursive: true });

    const promise = landTrackToMain("missing-worktree-track");
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).rejects.toThrow(HarnessError);
  });

  test("landTrackToMain throws INTEGRITY error on rebase conflict", () => {
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "fetch") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "rebase") {
        return {
          status: 1,
          stdout: "CONFLICT (content): Merge conflict in src/file.ts\n",
          stderr: "",
        };
      }
      if (argv[0] === "diff") {
        return { status: 0, stdout: "src/file.ts\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-conflict");
    mkdirSync(worktreeDir, { recursive: true });

    expect(() =>
      landTrackToMain({
        trackId: "track-conflict",
        repoRoot: TEST_DIR,
        remote: "origin",
        runner: mockRunner,
      }),
    ).toThrow(HarnessError);
  });

  test("destroyTrackWorktree cleans worktree directory, deletes branch, and releases lock", () => {
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
      if (argv[0] === "show-ref" && argv.includes("refs/heads/track/track-existing")) {
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
});
