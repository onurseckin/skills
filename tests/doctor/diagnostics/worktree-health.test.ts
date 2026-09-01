import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  autoHealWorktreeState,
  checkWorktreeHealth,
} from "../../../olt/scripts/src/reporting/doctor/worktree-health-engine.ts";
import type { GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";

export const worktreeHealthSuiteName = "Worktree Health Engine Diagnostics";

const vfs = new Map<string, { isDir: boolean; content?: string }>();
const spies: Array<{ mockRestore: () => void }> = [];

const getStats = (p: fs.PathLike): fs.Stats => {
  const s = String(p),
    n = vfs.get(s);
  if (!n) throw new Error(`ENOENT: ${s}`);
  return {
    dev: 1,
    ino: 1,
    nlink: 1,
    isFile: () => !n.isDir,
    isDirectory: () => n.isDir,
    isSymbolicLink: () => false,
    mode: n.isDir ? 0o755 : 0o644,
    size: n.content ? Buffer.byteLength(n.content) : 0,
    mtimeMs: Date.now(),
  } as fs.Stats;
};
const listDir = (p: fs.PathLike, opt?: unknown) => {
  const pref = `${String(p).replace(/\/+$/, "")}/`,
    ent = new Map<string, boolean>();
  for (const [k, v] of vfs.entries())
    if (k.startsWith(pref) && k.length > pref.length) {
      const seg = k.slice(pref.length).split("/")[0];
      if (seg && !ent.has(seg)) ent.set(seg, k.slice(pref.length).includes("/") || v.isDir);
    }
  const wt = typeof opt === "object" && opt !== null && "withFileTypes" in opt;
  return (wt
    ? Array.from(ent.entries()).map(([n, d]) => ({
        name: n,
        isDirectory: () => d,
        isFile: () => !d,
        isSymbolicLink: () => false,
      }))
    : Array.from(ent.keys())) as unknown as fs.Dirent[];
};

function setupVirtualFs(): void {
  vfs.clear();
  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => vfs.has(String(p))),
    spyOn(fs, "statSync").mockImplementation(getStats),
    spyOn(fs, "lstatSync").mockImplementation(getStats),
    spyOn(fs, "readdirSync").mockImplementation(listDir),
    spyOn(fs, "readFileSync").mockImplementation((p) => {
      const n = vfs.get(String(p));
      if (!n || n.content === undefined) throw new Error(`ENOENT: ${String(p)}`);
      return n.content;
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      vfs.set(String(p), { content: String(d), isDir: false });
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      vfs.set(String(p), { isDir: true });
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      const pref = `${String(p).replace(/\/+$/, "")}/`;
      for (const k of Array.from(vfs.keys()))
        if (k === String(p) || k.startsWith(pref)) vfs.delete(k);
    }),
    spyOn(fs, "unlinkSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(fs, "realpathSync").mockImplementation((p) => String(p)),
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
});

function initWorktreeRepo(scratch: string) {
  setupVirtualFs();
  vfs.set(scratch, { isDir: true });
  vfs.set(join(scratch, ".git"), { isDir: true });
  vfs.set(join(scratch, ".olt", "worktrees"), { isDir: true });
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
    setupVirtualFs();
    const scratch = "/virtual/wt-string-path";
    vfs.set(scratch, { isDir: true });
    vfs.set(join(scratch, ".git"), { isDir: true });
    const res = checkWorktreeHealth(scratch);
    expect(res.healthy).toBe(true);
  });

  test("checkWorktreeHealth detects dead PID in lock file and auto-heals", () => {
    const scratch = initWorktreeRepo("/virtual/wt-dead-lock");
    const worktreeDir = join(scratch, ".olt", "worktrees", "track-dead");
    const locksDir = join(scratch, ".olt", "worktrees", "locks");
    vfs.set(worktreeDir, { isDir: true });
    vfs.set(locksDir, { isDir: true });
    vfs.set(join(locksDir, "track-dead.lock"), {
      content: JSON.stringify({ pid: 999999999, trackId: "track-dead" }),
      isDir: false,
    });

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
    expect(healed.healthy && !fs.existsSync(join(locksDir, "track-dead.lock"))).toBe(true);
  });

  test("checkWorktreeHealth detects merged track branches and auto-heals", () => {
    const scratch = initWorktreeRepo("/virtual/wt-merged");
    const worktreeDir = join(scratch, ".olt", "worktrees", "track-merged");
    vfs.set(worktreeDir, { isDir: true });

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
    vfs.set(worktreeDir, { isDir: true });
    vfs.set(locksDir, { isDir: true });
    vfs.set(join(locksDir, "track-unmerged-dead.lock"), {
      content: JSON.stringify({ pid: 999999998, trackId: "track-unmerged-dead" }),
      isDir: false,
    });

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
    vfs.set(locksDir, { isDir: true });
    const corruptLockPath = join(locksDir, "track-corrupt.lock");
    vfs.set(corruptLockPath, { content: "NOT_JSON{{{", isDir: false });

    const report = checkWorktreeHealth({ repoRoot: scratch, autoHeal: false });
    expect(
      !report.healthy && report.findings.some((f) => f.code === "WORKTREE_CORRUPTED_METADATA"),
    ).toBe(true);

    const healed = autoHealWorktreeState({ repoRoot: scratch });
    expect(healed.healthy && !fs.existsSync(corruptLockPath)).toBe(true);
  });

  test("checkWorktreeHealth detects orphaned worktree directories and cleans them", () => {
    const scratch = initWorktreeRepo("/virtual/wt-orphan-dir");
    const orphanDir = join(scratch, ".olt", "worktrees", "orphan-worktree");
    vfs.set(orphanDir, { isDir: true });

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
    expect(healed.healthy && !fs.existsSync(orphanDir)).toBe(true);
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
