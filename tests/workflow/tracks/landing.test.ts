import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";
import { landTrackToMain } from "../../../olt/scripts/src/workflow/worktree/index.ts";

const TEST_DIR = "/virtual/worktree-land-repo";

describe("track worktree landing pipeline (in-memory virtualization)", () => {
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
    const appendSpy = spyOn(fs, "appendFileSync").mockImplementation((p, data) => {
      const prev = files.get(String(p)) ?? "";
      files.set(String(p), prev + String(data));
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

    harness = {
      files,
      dirs,
      restore() {
        existsSpy.mockRestore();
        mkdirSpy.mockRestore();
        writeSpy.mockRestore();
        appendSpy.mockRestore();
        readSpy.mockRestore();
        rmSpy.mockRestore();
        unlinkSpy.mockRestore();
      },
    };
  });

  afterEach(() => {
    harness.restore();
  });

  test("landTrackToMain successfully rebases, pushes, writes telemetry and cleans up", () => {
    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
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
    harness.dirs.add(worktreeDir);
    harness.dirs.add(join(TEST_DIR, ".olt", "worktrees", "locks"));
    harness.files.set(lockPath, JSON.stringify({ pid: process.pid, trackId: "track-landing-1" }));

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
    expect(harness.files.has(telemetryPath)).toBe(true);
    const line = (harness.files.get(telemetryPath) ?? "").trim();
    const parsed = JSON.parse(line);
    expect(parsed.trackId).toBe("track-landing-1");
    expect(parsed.event).toBe("track_landed");
    expect(parsed.commitSha).toBe("abc123def456");

    expect(harness.files.has(lockPath)).toBe(false);
  });

  test("landTrackToMain handles local-only repository gracefully", () => {
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "rev-parse" && argv[1] === "HEAD")
        return { status: 0, stdout: "localsha123\n", stderr: "" };
      if (argv[0] === "branch" && argv[1] === "-f") return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-local");
    harness.dirs.add(worktreeDir);

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
    harness.dirs.add(worktreeDir);

    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
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
    harness.dirs.add(worktreeDir);

    let pushCount = 0;
    const mockRunner: GitRunner = (_cwd, argv) => {
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
    expect(pushCount).toBe(2);
  });

  test("landTrackToMain throws INTEGRITY when rebase encounters conflicts", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "track-conflict");
    harness.dirs.add(worktreeDir);

    const mockRunner: GitRunner = (_cwd, argv) => {
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
    harness.dirs.add(worktreeDir);

    await expect(landTrackToMain("track-str")).rejects.toBeDefined();
  });
});
