import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  autoHealWorktreeState,
  checkWorktreeHealth,
} from "../../../olt/scripts/src/reporting/doctor/worktree-health-engine.ts";
import type { GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";

const TEST_DIR = join(process.cwd(), ".olt", "scratch", "test-doctor-wt");

describe("worktree health engine", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("checkWorktreeHealth returns healthy on clean repo", () => {
    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(report.name).toBe("worktree_health");
    expect(report.healthy).toBe(true);
    expect(report.issues.length).toBe(0);
  });

  test("checkWorktreeHealth detects dead PID in lock file and auto-heals", () => {
    const locksDir = join(TEST_DIR, ".olt", "worktrees", "locks");
    mkdirSync(locksDir, { recursive: true });
    const deadLockPath = join(locksDir, "track-dead.lock");
    writeFileSync(deadLockPath, JSON.stringify({ pid: 999999999, trackId: "track-dead" }), "utf8");

    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "worktree" && argv[1] === "prune")
        return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const audit = checkWorktreeHealth({ repoRoot: TEST_DIR, runner: mockRunner, autoHeal: false });
    expect(audit.healthy).toBe(false);
    expect(audit.issues.some((i) => i.includes("999999999"))).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(healed.healthy).toBe(true);
    expect(healed.repaired.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(deadLockPath)).toBe(false);
  });

  test("checkWorktreeHealth detects merged track branches", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-merged");
    mkdirSync(worktreeDir, { recursive: true });

    const mockPorcelain = [
      `worktree ${worktreeDir}`,
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/track/track-merged",
      "",
    ].join("\n");

    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: mockPorcelain, stderr: "" };
      if (argv[0] === "branch" && argv[1] === "--merged")
        return { status: 0, stdout: "track/track-merged\n", stderr: "" };
      if (argv[0] === "worktree") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "branch" && argv[1] === "-D") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: TEST_DIR, runner: mockRunner, autoHeal: false });
    expect(report.healthy).toBe(false);
    expect(report.issues.some((i) => i.includes("merged into main"))).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(healed.healthy).toBe(true);
  });
});
