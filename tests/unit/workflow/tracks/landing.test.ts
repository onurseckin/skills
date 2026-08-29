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
});
