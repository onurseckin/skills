import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { checkWorktreeHealth } from "../../olt/scripts/src/reporting/doctor/worktree-health-engine.ts";
import type { GitRunner } from "../../olt/scripts/src/workflow/worktree/git-ops.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Doctor Worktree Health - Task & Track Reconciliation", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let repoCounter = 0;

  beforeEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  function createVirtualRepo(prefix: string): string {
    const dir = `/virtual/worktrees/${prefix}-${++repoCounter}`;
    vfs.mkdirSync(join(dir, ".git"), { recursive: true });
    vfs.mkdirSync(join(dir, ".olt", "worktrees"), { recursive: true });
    return dir;
  }

  it("checkWorktreeHealth emits UNTRACKED_WORKTREE_DETECTED with severity ERROR when task missing", () => {
    const dir = createVirtualRepo("wt-untracked");
    const wtDir = join(dir, ".olt", "worktrees", "track-rogue");
    vfs.mkdirSync(wtDir, { recursive: true });
    vfs.writeFileSync(
      join(wtDir, ".worktree-meta.json"),
      JSON.stringify({
        trackId: "track-rogue",
        status: "active",
        branch: "track/track-rogue",
        worktreePath: wtDir,
      }),
    );

    const runner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list") {
        return {
          status: 0,
          stdout: `worktree ${wtDir}\nbranch refs/heads/track/track-rogue\n`,
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({
      repoRoot: dir,
      runner,
      tasks: { "task-alpha": { id: "task-alpha", trackId: "track-alpha" } },
    });

    expect(report.healthy).toBe(false);
    expect(report.passed).toBe(false);

    const finding = report.findings.find((f) => f.code === "UNTRACKED_WORKTREE_DETECTED");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("ERROR");
    expect(finding?.message).toBe(
      "Untracked worktree 'track-rogue' detected without associated task or track reservation",
    );
    expect(finding?.details?.trackId).toBe("track-rogue");
    expect(finding?.details?.worktreePath).toBe(wtDir);
  });

  it("checkWorktreeHealth passes reconciliation when worktree is associated in tasks or state", () => {
    const dir = createVirtualRepo("wt-matched");
    const wtDir = join(dir, ".olt", "worktrees", "track-known");
    vfs.mkdirSync(wtDir, { recursive: true });
    vfs.writeFileSync(
      join(wtDir, ".worktree-meta.json"),
      JSON.stringify({
        trackId: "track-known",
        status: "active",
        branch: "track/track-known",
        worktreePath: wtDir,
      }),
    );

    const runner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list") {
        return {
          status: 0,
          stdout: `worktree ${wtDir}\nbranch refs/heads/track/track-known\n`,
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    // 1. Matched via tasks
    const reportTasks = checkWorktreeHealth({
      repoRoot: dir,
      runner,
      tasks: { "task-1": { id: "task-1", trackId: "track-known" } },
    });
    expect(reportTasks.findings.some((f) => f.code === "UNTRACKED_WORKTREE_DETECTED")).toBe(false);
    expect(reportTasks.healthy).toBe(true);

    // 2. Matched via state.tracks
    const reportState = checkWorktreeHealth({
      repoRoot: dir,
      runner,
      state: { tracks: ["track-known"] },
    });
    expect(reportState.findings.some((f) => f.code === "UNTRACKED_WORKTREE_DETECTED")).toBe(false);
    expect(reportState.healthy).toBe(true);
  });

  it("skips task reconciliation when tasks and state are omitted", () => {
    const dir = createVirtualRepo("wt-omitted");
    const wtDir = join(dir, ".olt", "worktrees", "track-active");
    vfs.mkdirSync(wtDir, { recursive: true });
    vfs.writeFileSync(
      join(wtDir, ".worktree-meta.json"),
      JSON.stringify({
        trackId: "track-active",
        status: "active",
        branch: "track/track-active",
        worktreePath: wtDir,
      }),
    );

    const runner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list") {
        return {
          status: 0,
          stdout: `worktree ${wtDir}\nbranch refs/heads/track/track-active\n`,
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const report = checkWorktreeHealth({ repoRoot: dir, runner });
    expect(report.findings.some((f) => f.code === "UNTRACKED_WORKTREE_DETECTED")).toBe(false);
    expect(report.healthy).toBe(true);
  });
});
