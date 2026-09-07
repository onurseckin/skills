import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { join } from "node:path";
import {
  worktreeCleanCommand,
  worktreeCreateCommand,
} from "../../olt/scripts/src/cli/commands/worktree-ops.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  autoHealWorktreeState,
  checkWorktreeHealth,
} from "../../olt/scripts/src/reporting/doctor/worktree-health-engine.ts";
import type { GitRunner } from "../../olt/scripts/src/workflow/worktree/git-ops.ts";
import { setGitRunnerForTesting } from "../../olt/scripts/src/workflow/worktree/git.ts";
import {
  createOrchestratorWorktree,
  createTrackWorktree,
  createWorktree,
  destroyOrchestratorWorktree,
  listOrchestratorWorktrees,
  listWorktrees,
} from "../../olt/scripts/src/workflow/worktree/index.ts";
import type { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { setupWorkflowVirtualFs } from "../workflow/shared/index.ts";

const TEST_DIR = "/virtual/orch-worktree-suite";
const ACTIVE_PID = 580;
let vfs: VirtualMemoryFS;
let vfsCleanup: (() => void) | undefined;
let restoreGit: (() => void) | undefined;
let killSpy: ReturnType<typeof spyOn> | undefined;

describe("Orchestrator Worktree Allocation & Reconciliation", () => {
  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfs = setup.vfs;
    vfsCleanup = setup.cleanup;
    restoreGit = setGitRunnerForTesting((_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" }));

    const origKill = process.kill;
    killSpy = spyOn(process, "kill").mockImplementation(((pid: number, sig?: string | number) => {
      if (pid === ACTIVE_PID) return true;
      return origKill.call(process, pid, sig as never);
    }) as never);

    vfs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    killSpy?.mockRestore();
    killSpy = undefined;
    restoreGit?.();
    restoreGit = undefined;
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("provisions orchestrator worktree with domain, branch, and metadata", () => {
    const executed: string[][] = [];
    const mockRunner: GitRunner = (_cwd, argv) => {
      executed.push([...argv]);
      return { status: 0, stdout: "", stderr: "" };
    };

    const record = createOrchestratorWorktree({
      domain: "dispatch",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });

    expect(record.domain).toBe("dispatch");
    expect(record.trackId).toBe("orch-dispatch");
    expect(record.worktreeId).toBe("orch-dispatch");
    expect(record.branch).toBe("orch/dispatch");
    expect(record.tier).toBe("orchestrator");
    expect(vfs.existsSync(record.worktreePath)).toBe(true);
    expect(vfs.existsSync(record.lockPath)).toBe(true);

    const metaPath = join(record.worktreePath, ".worktree-meta.json");
    expect(vfs.existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(vfs.readFileSync(metaPath, "utf8"));
    expect(meta.domain).toBe("dispatch");
    expect(meta.tier).toBe("orchestrator");
    expect(executed.some((c) => c[0] === "worktree" && c[1] === "add")).toBe(true);
  });

  test("rejects invalid orchestrator domain identifiers", () => {
    expect(() => createOrchestratorWorktree({ domain: "", repoRoot: TEST_DIR })).toThrow(
      HarnessError,
    );
    expect(() => createOrchestratorWorktree({ domain: "bad/domain", repoRoot: TEST_DIR })).toThrow(
      HarnessError,
    );
    expect(() => createOrchestratorWorktree({ domain: "bad spaces", repoRoot: TEST_DIR })).toThrow(
      HarnessError,
    );
  });

  test("delegates orchestrator provisioning through createWorktree and createTrackWorktree", () => {
    const mockRunner: GitRunner = (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" });

    const orch1 = createWorktree({
      tier: "orchestrator",
      orchestrator: "sentinel",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });
    expect(orch1.domain).toBe("sentinel");
    expect(orch1.tier).toBe("orchestrator");

    const orch2 = createTrackWorktree({
      tier: "orchestrator",
      orchestrator: "fleet",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });
    expect(orch2.domain).toBe("fleet");
    expect(orch2.tier).toBe("orchestrator");
  });

  test("handles lock timeouts and stale lock eviction for orchestrator worktrees", () => {
    const lockDir = join(TEST_DIR, ".olt", "worktrees", "locks");
    vfs.mkdirSync(lockDir, { recursive: true });

    const lockedPath = join(lockDir, "orch-contended.lock");
    vfs.writeFileSync(
      lockedPath,
      JSON.stringify({
        trackId: "orch-contended",
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }),
    );
    expect(() =>
      createOrchestratorWorktree({
        domain: "contended",
        repoRoot: TEST_DIR,
        lockTimeoutMs: -1,
        runner: () => ({ status: 0, stdout: "", stderr: "" }),
      }),
    ).toThrow(HarnessError);

    const deadLockPath = join(lockDir, "orch-stale.lock");
    vfs.writeFileSync(
      deadLockPath,
      JSON.stringify({
        trackId: "orch-stale",
        pid: 999999999,
        createdAt: new Date().toISOString(),
      }),
    );
    const mockRunner: GitRunner = (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" });
    const res = createOrchestratorWorktree({
      domain: "stale",
      repoRoot: TEST_DIR,
      runner: mockRunner,
    });
    expect(res.domain).toBe("stale");
  });

  test("teardown protects active worktrees from destruction unless forced", () => {
    const worktreeDir = join(TEST_DIR, ".olt", "worktrees", "orch-active-test");
    const lockDir = join(TEST_DIR, ".olt", "worktrees", "locks");
    const lockPath = join(lockDir, "orch-active-test.lock");
    vfs.mkdirSync(worktreeDir, { recursive: true });
    vfs.mkdirSync(lockDir, { recursive: true });
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: ACTIVE_PID, trackId: "orch-active-test" }),
      "utf8",
    );

    const mockRunner: GitRunner = (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" });

    expect(() =>
      destroyOrchestratorWorktree({
        domain: "active-test",
        repoRoot: TEST_DIR,
        runner: mockRunner,
      }),
    ).toThrow(HarnessError);

    const forceRes = destroyOrchestratorWorktree({
      domain: "active-test",
      repoRoot: TEST_DIR,
      force: true,
      runner: mockRunner,
    });
    expect(forceRes.cleaned).toBe(true);
    expect(vfs.existsSync(worktreeDir)).toBe(false);
  });

  test("lists orchestrator worktrees with filtering", () => {
    const mockRunner: GitRunner = (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" });
    createOrchestratorWorktree({ domain: "domain-one", repoRoot: TEST_DIR, runner: mockRunner });
    createTrackWorktree({ trackId: "track-one", repoRoot: TEST_DIR, runner: mockRunner });

    const orchOnly = listOrchestratorWorktrees({ repoRoot: TEST_DIR });
    expect(orchOnly.length).toBe(1);
    expect(orchOnly[0]!.domain).toBe("domain-one");

    const trackOnly = listWorktrees({ repoRoot: TEST_DIR, tier: "track" });
    expect(trackOnly.some((w) => w.trackId === "track-one")).toBe(true);
    expect(trackOnly.some((w) => w.trackId === "orch-domain-one")).toBe(false);
  });

  test("universal doctor reconciles orchestrator worktrees and auto-heals dead ones", () => {
    const mockRunner: GitRunner = (_cwd, _argv) => ({ status: 0, stdout: "", stderr: "" });
    createOrchestratorWorktree({ domain: "health-test", repoRoot: TEST_DIR, runner: mockRunner });

    const initialReport = checkWorktreeHealth({
      repoRoot: TEST_DIR,
      runner: mockRunner,
      tasks: { "some-other-task": {} },
    });
    expect(initialReport.healthy).toBe(true);
    expect(initialReport.issues.length).toBe(0);

    const lockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "orch-health-test.lock");
    vfs.writeFileSync(
      lockPath,
      JSON.stringify({
        trackId: "orch-health-test",
        pid: 999999999,
        createdAt: new Date().toISOString(),
      }),
    );

    const deadReport = checkWorktreeHealth({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(deadReport.healthy).toBe(false);
    expect(deadReport.findings.some((f) => f.code === "WORKTREE_DEAD_PID_LOCK")).toBe(true);

    const healedReport = autoHealWorktreeState({ repoRoot: TEST_DIR, runner: mockRunner });
    expect(healedReport.repaired.length).toBeGreaterThan(0);
    expect(vfs.existsSync(join(TEST_DIR, ".olt", "worktrees", "orch-health-test"))).toBe(false);
  });

  test("CLI commands support orchestrator worktree creation and safe clean", () => {
    const createRes = worktreeCreateCommand({
      tier: "orchestrator",
      orchestrator: "billing",
      "repo-root": TEST_DIR,
    });
    expect(createRes.tier).toBe("orchestrator");
    expect(createRes.domain).toBe("billing");
    expect(vfs.existsSync(createRes.worktree_path as string)).toBe(true);

    const protectedLockPath = join(TEST_DIR, ".olt", "worktrees", "locks", "orch-billing.lock");
    vfs.writeFileSync(
      protectedLockPath,
      JSON.stringify({ pid: ACTIVE_PID, trackId: "orch-billing" }),
      "utf8",
    );

    const cleanRes = worktreeCleanCommand({ all: true, "repo-root": TEST_DIR });
    expect(cleanRes.count).toBe(0);
    const skipped = cleanRes.skipped as { skipped: boolean; trackId: string }[];
    expect(skipped.some((s) => s.trackId === "orch-billing")).toBe(true);
    expect(vfs.existsSync(createRes.worktree_path as string)).toBe(true);
  });
});
