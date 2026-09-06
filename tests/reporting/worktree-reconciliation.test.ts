import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWorktreeHealth } from "../../olt/scripts/src/reporting/doctor/worktree-health-engine.ts";
import type { GitRunner } from "../../olt/scripts/src/workflow/worktree/git-ops.ts";

function createTempRepo(prefix: string): { dir: string; cleanup: () => void } {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(join(dir, ".git"), { recursive: true });
  mkdirSync(join(dir, ".olt", "worktrees"), { recursive: true });
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

describe("Doctor Worktree Health - Task & Track Reconciliation", () => {
  it("checkWorktreeHealth emits UNTRACKED_WORKTREE_DETECTED with severity ERROR when task missing", () => {
    const { dir, cleanup } = createTempRepo("wt-untracked");
    try {
      const wtDir = join(dir, ".olt", "worktrees", "track-rogue");
      mkdirSync(wtDir, { recursive: true });
      writeFileSync(
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
    } finally {
      cleanup();
    }
  });

  it("checkWorktreeHealth passes reconciliation when worktree is associated in tasks or state", () => {
    const { dir, cleanup } = createTempRepo("wt-matched");
    try {
      const wtDir = join(dir, ".olt", "worktrees", "track-known");
      mkdirSync(wtDir, { recursive: true });
      writeFileSync(
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
      expect(reportTasks.findings.some((f) => f.code === "UNTRACKED_WORKTREE_DETECTED")).toBe(
        false,
      );
      expect(reportTasks.healthy).toBe(true);

      // 2. Matched via state.tracks
      const reportState = checkWorktreeHealth({
        repoRoot: dir,
        runner,
        state: { tracks: ["track-known"] },
      });
      expect(reportState.findings.some((f) => f.code === "UNTRACKED_WORKTREE_DETECTED")).toBe(
        false,
      );
      expect(reportState.healthy).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("skips task reconciliation when tasks and state are omitted", () => {
    const { dir, cleanup } = createTempRepo("wt-omitted");
    try {
      const wtDir = join(dir, ".olt", "worktrees", "track-active");
      mkdirSync(wtDir, { recursive: true });
      writeFileSync(
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
    } finally {
      cleanup();
    }
  });
});
