import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  autoHealWorktreeState,
  checkWorktreeHealth,
} from "../../../olt/scripts/src/reporting/doctor/worktree-health-engine.ts";
import type { GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";

export const worktreeHealthSuiteName = "Worktree Health Engine Diagnostics";

const roots: string[] = [];
let TEST_DIR: string;

describe(worktreeHealthSuiteName, () => {
  beforeEach(() => {
    TEST_DIR = mkdtempSync(join(tmpdir(), "doctor-wt-health-"));
    roots.push(TEST_DIR);
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("checkWorktreeHealth returns healthy on clean repo", () => {
    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(report.name).toBe("worktree_health");
    expect(report.engine).toBe("checkWorktreeHealth");
    expect(report.healthy).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.issues.length).toBe(0);
    expect(report.findings.length).toBe(0);
  });

  test("checkWorktreeHealth accepts string repoRoot path", () => {
    const report = checkWorktreeHealth(TEST_DIR);
    expect(report.name).toBe("worktree_health");
    expect(report.healthy).toBe(true);
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
    expect(audit.findings.some((f) => f.code === "WORKTREE_ORPHANED_LOCK")).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(healed.healthy).toBe(true);
    expect(healed.repaired.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(deadLockPath)).toBe(false);
  });

  test("checkWorktreeHealth detects merged track branches and auto-heals", () => {
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
    expect(report.findings.some((f) => f.code === "WORKTREE_MERGED_NOT_CLEANED")).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(healed.healthy).toBe(true);
    expect(healed.repaired.some((r) => r.includes("track-merged"))).toBe(true);
  });

  test("checkWorktreeHealth detects unmerged branch held by dead agent", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-unmerged-dead");
    const locksDir = join(TEST_DIR, ".olt", "worktrees", "locks");
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(locksDir, { recursive: true });
    writeFileSync(
      join(locksDir, "track-unmerged-dead.lock"),
      JSON.stringify({ pid: 999999998, trackId: "track-unmerged-dead" }),
      "utf8",
    );

    const mockPorcelain = [
      `worktree ${worktreeDir}`,
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/track/track-unmerged-dead",
      "",
    ].join("\n");

    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: mockPorcelain, stderr: "" };
      if (argv[0] === "branch" && argv[1] === "--merged")
        return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "worktree") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "branch" && argv[1] === "-D") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: TEST_DIR, runner: mockRunner, autoHeal: false });
    expect(report.healthy).toBe(false);
    expect(report.findings.some((f) => f.code === "WORKTREE_DEAD_PID_LOCK")).toBe(true);
    expect(report.findings.some((f) => f.code === "WORKTREE_UNMERGED_DEAD_AGENT_BRANCH")).toBe(
      true,
    );

    const healed = autoHealWorktreeState({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(healed.healthy).toBe(true);
  });

  test("checkWorktreeHealth detects corrupted lock files and heals them", () => {
    const locksDir = join(TEST_DIR, ".olt", "worktrees", "locks");
    mkdirSync(locksDir, { recursive: true });
    const corruptLockPath = join(locksDir, "track-corrupt.lock");
    writeFileSync(corruptLockPath, "NOT_JSON{{{", "utf8");

    const report = checkWorktreeHealth({ repoRoot: TEST_DIR, autoHeal: false });
    expect(report.healthy).toBe(false);
    expect(report.findings.some((f) => f.code === "WORKTREE_CORRUPTED_METADATA")).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: TEST_DIR });
    expect(healed.healthy).toBe(true);
    expect(existsSync(corruptLockPath)).toBe(false);
  });

  test("checkWorktreeHealth detects orphaned worktree directories and cleans them", () => {
    const orphanDir = join(TEST_DIR, ".olt", "worktrees", "orphan-worktree");
    mkdirSync(orphanDir, { recursive: true });

    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: TEST_DIR, runner: mockRunner, autoHeal: false });
    expect(report.healthy).toBe(false);
    expect(report.findings.some((f) => f.code === "WORKTREE_ORPHANED_DIR")).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(healed.healthy).toBe(true);
    expect(existsSync(orphanDir)).toBe(false);
  });

  test("checkWorktreeHealth detects prunable git worktrees and prunes them", () => {
    const missingWorktreePath = join(TEST_DIR, ".olt", "worktrees", "vanished-wt");
    const mockPorcelain = [
      `worktree ${missingWorktreePath}`,
      "HEAD 3333333333333333333333333333333333333333",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");

    let pruned = false;
    const mockRunner: GitRunner = (cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: mockPorcelain, stderr: "" };
      if (argv[0] === "worktree" && argv[1] === "prune") {
        pruned = true;
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: TEST_DIR, runner: mockRunner, autoHeal: false });
    expect(report.healthy).toBe(false);
    expect(report.findings.some((f) => f.code === "WORKTREE_PRUNABLE_GIT_ENTRY")).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(pruned).toBe(true);
    expect(healed.repaired.some((r) => r.includes("Pruned"))).toBe(true);
  });
});
