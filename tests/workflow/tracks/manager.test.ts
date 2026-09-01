import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";
import {
  cleanupTrackWorktree,
  createTrackWorktree,
  destroyTrackWorktree,
  listTrackWorktrees,
} from "../../../olt/scripts/src/workflow/worktree/index.ts";

const TEST_DIR = "/virtual/worktree-mgr-repo";

describe("track worktree manager (in-memory virtualization)", () => {
  let harness: { files: Map<string, string>; dirs: Set<string>; restore: () => void };

  beforeEach(() => {
    const files = new Map<string, string>();
    const dirs = new Set<string>([TEST_DIR]);

    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = String(p);
      return files.has(s) || dirs.has(s);
    });
    const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
      dirs.add(String(p));
      return undefined as unknown as string;
    });
    const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
      files.set(String(p), String(data));
    });
    const readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const val = files.get(String(p));
      if (val === undefined) {
        throw Object.assign(new Error(`ENOENT: open '${String(p)}'`), { code: "ENOENT" });
      }
      return val;
    });
    const rmSpy = spyOn(fs, "rmSync").mockImplementation((p) => {
      const s = String(p);
      files.delete(s);
      dirs.delete(s);
    });
    const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation((p) => {
      files.delete(String(p));
    });
    const readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, options) => {
      const s = String(p);
      const entries: string[] = [];
      for (const d of dirs) {
        if (d.startsWith(s) && d !== s) {
          const rel = d
            .slice(s.length)
            .replace(/^[/\\]+/, "")
            .split(/[/\\]/)[0];
          if (rel && !entries.includes(rel)) entries.push(rel);
        }
      }
      if (
        typeof options === "object" &&
        options !== null &&
        (options as { withFileTypes?: boolean }).withFileTypes
      ) {
        return entries.map((name) => ({
          name,
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        })) as unknown as fs.Dirent[];
      }
      return entries as unknown as string[];
    });
    const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
      return {
        mtimeMs: Date.now(),
        isDirectory: () => dirs.has(String(p)),
        isFile: () => files.has(String(p)),
      } as unknown as fs.Stats;
    });

    harness = {
      files,
      dirs,
      restore() {
        existsSpy.mockRestore();
        mkdirSpy.mockRestore();
        writeSpy.mockRestore();
        readSpy.mockRestore();
        rmSpy.mockRestore();
        unlinkSpy.mockRestore();
        readdirSpy.mockRestore();
        statSpy.mockRestore();
      },
    };
  });

  afterEach(() => {
    harness.restore();
  });

  test("createTrackWorktree creates worktree and acquires lock", () => {
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "rev-parse") return { status: 1, stdout: "", stderr: "" };
      if (argv[0] === "worktree" && argv[1] === "add") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const record = createTrackWorktree({
      trackId: "track-alpha",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(record.trackId).toBe("track-alpha");
    expect(record.branch).toBe("track/track-alpha");
    expect(record.baseBranch).toBe("main");
    expect(record.worktreePath).toBe(join(TEST_DIR, ".olt", "worktrees", "track-alpha"));
    expect(record.lockPath).toBe(join(TEST_DIR, ".olt", "worktrees", "locks", "track-alpha.lock"));
    expect(harness.files.has(record.lockPath)).toBe(true);

    const lockContent = JSON.parse(harness.files.get(record.lockPath) ?? "{}");
    expect(lockContent.trackId).toBe("track-alpha");
    expect(lockContent.pid).toBe(process.pid);
  });

  test("createTrackWorktree throws INVALID_ARGUMENT when trackId is missing or invalid", () => {
    expect(() => createTrackWorktree({ trackId: "", repoRoot: TEST_DIR })).toThrow(HarnessError);
  });

  test("createTrackWorktree fails and cleans lock on git error", () => {
    const failingRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree") {
        return { status: 128, stdout: "", stderr: "fatal: branch already exists" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      createTrackWorktree({
        trackId: "track-err",
        repoRoot: TEST_DIR,
        runner: failingRunner,
      }),
    ).toThrow(HarnessError);

    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "track-err.lock");
    expect(harness.files.has(lockPath)).toBe(false);
  });

  test("cleanupTrackWorktree removes worktree directory, branch and lock", () => {
    const executedGit: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executedGit.push([...argv]);
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-beta");
    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "track-beta.lock");
    harness.dirs.add(worktreeDir);
    harness.dirs.add(join(TEST_DIR, ".olt", "worktrees", "locks"));
    harness.files.set(lockPath, JSON.stringify({ pid: process.pid, trackId: "track-beta" }));

    const result = cleanupTrackWorktree({
      trackId: "track-beta",
      repoRoot: TEST_DIR,
      force: true,
      runner: mockRunner,
    });

    expect(result.trackId).toBe("track-beta");
    expect(result.cleaned).toBe(true);
    expect(harness.files.has(lockPath)).toBe(false);

    expect(executedGit.some((args) => args[0] === "worktree" && args[1] === "remove")).toBe(true);
    expect(executedGit.some((args) => args[0] === "branch" && args[1] === "-D")).toBe(true);
    expect(executedGit.some((args) => args[0] === "worktree" && args[1] === "prune")).toBe(true);
  });

  test("listTrackWorktrees reads worktree metadata from disk", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-1");
    harness.dirs.add(worktreeDir);
    harness.dirs.add(join(TEST_DIR, ".olt", "worktrees"));
    const metaPath = join(worktreeDir, ".worktree-meta.json");
    harness.files.set(
      metaPath,
      JSON.stringify({
        trackId: "track-1",
        worktreePath: worktreeDir,
        branch: "track/track-1",
        baseBranch: "main",
        lockPath: join(TEST_DIR, ".olt", "worktrees", "locks", "track-1.lock"),
        createdAt: new Date().toISOString(),
        status: "active",
      }),
    );

    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "worktree" && argv[1] === "list") {
        return {
          status: 0,
          stdout: `worktree ${worktreeDir}\nHEAD 111\nbranch refs/heads/track/track-1\n`,
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const list = listTrackWorktrees({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(list.length).toBe(1);
    expect(list[0]!.trackId).toBe("track-1");
  });

  test("createTrackWorktree accepts string trackId and returns path", () => {
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "rev-parse") return { status: 1, stdout: "", stderr: "" };
      if (argv[0] === "worktree" && argv[1] === "add") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreePath = createTrackWorktree({
      trackId: "track-gamma",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });
    expect(worktreePath.trackId).toBe("track-gamma");
    expect(worktreePath.worktreePath).toBe(join(TEST_DIR, ".olt", "worktrees", "track-gamma"));
  });

  test("destroyTrackWorktree with options cleans worktree and lock", () => {
    const executedGit: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executedGit.push([...argv]);
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-delta");
    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "track-delta.lock");
    harness.dirs.add(worktreeDir);
    harness.dirs.add(join(TEST_DIR, ".olt", "worktrees", "locks"));
    harness.files.set(lockPath, JSON.stringify({ pid: process.pid, trackId: "track-delta" }));

    const result = destroyTrackWorktree({
      trackId: "track-delta",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(result.trackId).toBe("track-delta");
    expect(result.cleaned).toBe(true);
    expect(harness.files.has(lockPath)).toBe(false);
    expect(executedGit.some((args) => args[0] === "worktree" && args[1] === "prune")).toBe(true);
  });
});
