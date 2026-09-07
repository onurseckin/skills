import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  autoHealWorktreeState,
  checkWorktreeHealth,
} from "../../../olt/scripts/src/reporting/doctor/worktree-health-engine.ts";
import type { GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const worktreeHealthSuiteName = "Worktree Health Engine Diagnostics";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession | null = null;

beforeEach(() => {
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
});

afterEach(() => {
  session?.cleanup();
  session = null;
});

function initWorktreeRepo(scratch: string) {
  vfs.mkdirSync(scratch, { recursive: true });
  vfs.mkdirSync(join(scratch, ".git"), { recursive: true });
  vfs.mkdirSync(join(scratch, ".olt", "worktrees"), { recursive: true });
  return scratch;
}

describe(worktreeHealthSuiteName, () => {
  test("checkWorktreeHealth returns healthy on clean repo", () => {
    const scratch = initWorktreeRepo("/virtual/wt-clean");
    const mockRunner: GitRunner = () => ({ status: 0, stdout: "", stderr: "" });
    const res = checkWorktreeHealth({ repoRoot: scratch, runner: mockRunner });
    expect(res.healthy && res.findings.length === 0).toBe(true);
  });

  test("checkWorktreeHealth accepts string repoRoot path", () => {
    const scratch = "/virtual/wt-string-path";
    vfs.mkdirSync(scratch, { recursive: true });
    vfs.mkdirSync(join(scratch, ".git"), { recursive: true });
    const res = checkWorktreeHealth(scratch);
    expect(res.healthy).toBe(true);
  });

  test("checkWorktreeHealth detects dead PID in lock file and auto-heals", () => {
    const scratch = initWorktreeRepo("/virtual/wt-dead-lock");
    const worktreeDir = join(scratch, ".olt", "worktrees", "track-dead");
    const locksDir = join(scratch, ".olt", "worktrees", "locks");
    vfs.mkdirSync(worktreeDir, { recursive: true });
    vfs.mkdirSync(locksDir, { recursive: true });
    vfs.writeFileSync(
      join(locksDir, "track-dead.lock"),
      JSON.stringify({ pid: 999999999, trackId: "track-dead" }),
    );

    const mockPorcelain = `worktree ${worktreeDir}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/track/track-dead\n`;
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: mockPorcelain, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const res = checkWorktreeHealth({ repoRoot: scratch, runner: mockRunner, autoHeal: false });
    expect(!res.healthy && res.findings.some((f) => f.code === "WORKTREE_DEAD_PID_LOCK")).toBe(
      true,
    );

    const healed = autoHealWorktreeState({ repoRoot: scratch, runner: mockRunner });
    expect(healed.healthy && !vfs.existsSync(join(locksDir, "track-dead.lock"))).toBe(true);
  });

  test("checkWorktreeHealth detects merged track branches and auto-heals", () => {
    const scratch = initWorktreeRepo("/virtual/wt-merged");
    const worktreeDir = join(scratch, ".olt", "worktrees", "track-merged");
    vfs.mkdirSync(worktreeDir, { recursive: true });

    const mockPorcelain = `worktree ${worktreeDir}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/track/track-merged\n`;
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: mockPorcelain, stderr: "" };
      if (argv[0] === "branch" && argv[1] === "--merged")
        return { status: 0, stdout: "track/track-merged\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: scratch, runner: mockRunner, autoHeal: false });
    expect(
      !report.healthy && report.findings.some((f) => f.code === "WORKTREE_MERGED_NOT_CLEANED"),
    ).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: scratch, runner: mockRunner });
    expect(healed.healthy).toBe(true);
  });

  test("checkWorktreeHealth detects unmerged branch held by dead agent", () => {
    const scratch = initWorktreeRepo("/virtual/wt-unmerged-dead");
    const worktreeDir = join(scratch, ".olt", "worktrees", "track-unmerged-dead");
    const locksDir = join(scratch, ".olt", "worktrees", "locks");
    vfs.mkdirSync(worktreeDir, { recursive: true });
    vfs.mkdirSync(locksDir, { recursive: true });
    vfs.writeFileSync(
      join(locksDir, "track-unmerged-dead.lock"),
      JSON.stringify({ pid: 999999998, trackId: "track-unmerged-dead" }),
    );

    const mockPorcelain = `worktree ${worktreeDir}\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/track/track-unmerged-dead\n`;
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: mockPorcelain, stderr: "" };
      if (argv[0] === "branch" && argv[1] === "--merged")
        return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: scratch, runner: mockRunner, autoHeal: false });
    const f = report.findings;
    expect(
      !report.healthy &&
        f.some((x) => x.code === "WORKTREE_DEAD_PID_LOCK") &&
        f.some((x) => x.code === "WORKTREE_UNMERGED_DEAD_AGENT_BRANCH"),
    ).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: scratch, runner: mockRunner });
    expect(healed.healthy).toBe(true);
  });

  test("checkWorktreeHealth detects corrupted lock files and heals them", () => {
    const scratch = initWorktreeRepo("/virtual/wt-corrupt-lock");
    const locksDir = join(scratch, ".olt", "worktrees", "locks");
    vfs.mkdirSync(locksDir, { recursive: true });
    const corruptLockPath = join(locksDir, "track-corrupt.lock");
    vfs.writeFileSync(corruptLockPath, "NOT_JSON{{{");

    const report = checkWorktreeHealth({ repoRoot: scratch, autoHeal: false });
    expect(
      !report.healthy && report.findings.some((f) => f.code === "WORKTREE_CORRUPTED_METADATA"),
    ).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: scratch });
    expect(healed.healthy && !vfs.existsSync(corruptLockPath)).toBe(true);
  });

  test("checkWorktreeHealth detects orphaned worktree directories and cleans them", () => {
    const scratch = initWorktreeRepo("/virtual/wt-orphan-dir");
    const orphanDir = join(scratch, ".olt", "worktrees", "orphan-worktree");
    vfs.mkdirSync(orphanDir, { recursive: true });

    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: scratch, runner: mockRunner, autoHeal: false });
    expect(!report.healthy && report.findings.some((f) => f.code === "WORKTREE_ORPHANED_DIR")).toBe(
      true,
    );

    const healed = autoHealWorktreeState({ repoRoot: scratch, runner: mockRunner });
    expect(healed.healthy && !vfs.existsSync(orphanDir)).toBe(true);
  });

  test("checkWorktreeHealth detects prunable git worktrees and prunes them", () => {
    const scratch = initWorktreeRepo("/virtual/wt-prune");
    const missingWorktreePath = join(scratch, ".olt", "worktrees", "vanished-wt");
    const mockPorcelain = `worktree ${missingWorktreePath}\nHEAD 3333333333333333333333333333333333333333\nprunable gitdir file points to non-existent location\n`;

    let pruned = false;
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list")
        return { status: 0, stdout: mockPorcelain, stderr: "" };
      if (argv[0] === "worktree" && argv[1] === "prune") {
        pruned = true;
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: scratch, runner: mockRunner, autoHeal: false });
    expect(
      !report.healthy && report.findings.some((f) => f.code === "WORKTREE_PRUNABLE_GIT_ENTRY"),
    ).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: scratch, runner: mockRunner });
    expect(pruned && healed.repaired.some((r) => r.includes("Pruned"))).toBe(true);
  });
});
