import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  worktreeCleanCommand,
  worktreeCreateCommand,
  worktreeListCommand,
  worktreeStatusCommand,
} from "../../../olt/scripts/src/cli/commands/worktree-ops.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertDomainIsolation,
  cleanupTrackWorktree,
  createDomainLedger,
  createHermeticWorktree,
  isDomainSyncEligible,
  landHermeticWorktree,
  listTrackWorktrees,
  provisionDomainWorktree,
  syncDomainToGlobal,
  synchronizeAllDomains,
  validateDomainIsolation,
  type DomainLedgerState,
  type GitRunner,
  type WorktreeContext,
} from "../../../olt/scripts/src/engine/worktree/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Hermetic Worktree Pipeline", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = scratchRoot(import.meta.path, "worktree-isolation");
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("createHermeticWorktree provisions isolated worktree and returns context", async () => {
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "rev-parse") return { status: 0, stdout: "main\n", stderr: "" };
      if (argv[0] === "worktree") return { status: 0, stdout: "", stderr: "" };
      if (argv[0] === "show-ref") return { status: 1, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const ctx = await createHermeticWorktree("lane-alpha", {
      repoRoot: testDir,
      baseBranch: "main",
      runner: mockRunner,
    });

    expect(ctx.trackId).toBe("lane-alpha");
    expect(ctx.branch).toBe("track/lane-alpha");
    expect(ctx.baseBranch).toBe("main");
    expect(ctx.worktreePath).toBe(join(testDir, ".olt", "worktrees", "lane-alpha"));
    expect(existsSync(ctx.worktreePath)).toBe(true);

    const activeList = listTrackWorktrees({ repoRoot: testDir });
    expect(activeList.some((w) => w.trackId === "lane-alpha")).toBe(true);

    cleanupTrackWorktree({ trackId: "lane-alpha", repoRoot: testDir, runner: mockRunner });
  });

  test("createHermeticWorktree rejects invalid track identifiers", async () => {
    await expect(createHermeticWorktree("bad track/name!", { repoRoot: testDir })).rejects.toThrow(
      HarnessError,
    );
    await expect(createHermeticWorktree("", { repoRoot: testDir })).rejects.toThrow(HarnessError);
  });

  test("validateDomainIsolation flags overlapping write scopes across domains", () => {
    const isolatedDomains = [
      { domain: "engine", writeScope: ["olt/scripts/src/engine/**"] },
      { domain: "policy", writeScope: ["olt/scripts/src/policy/**"] },
      { domain: "telemetry", writeScope: ["olt/scripts/src/telemetry/**"] },
    ];
    const isolatedCheck = validateDomainIsolation(isolatedDomains);
    expect(isolatedCheck.isolated).toBe(true);
    expect(isolatedCheck.conflicts.length).toBe(0);
    expect(() => assertDomainIsolation(isolatedDomains)).not.toThrow();

    const conflictingDomains = [
      { domain: "engine", writeScope: ["olt/scripts/src/engine/**"] },
      { domain: "sub-engine", writeScope: ["olt/scripts/src/engine/worktree/**"] },
    ];
    const conflictCheck = validateDomainIsolation(conflictingDomains);
    expect(conflictCheck.isolated).toBe(false);
    expect(conflictCheck.conflicts.length).toBeGreaterThan(0);
    expect(() => assertDomainIsolation(conflictingDomains)).toThrow(HarnessError);
  });

  test("domain ledger and worktree provisioning tracks domain status and eligibility", () => {
    const mockRunner: GitRunner = () => ({ status: 0, stdout: "", stderr: "" });
    const ledger: DomainLedgerState = createDomainLedger(
      "harness-main",
      "sha-base-000",
      testDir,
      "main",
    );
    expect(ledger.harnessBranch).toBe("harness-main");
    expect(ledger.baseSha).toBe("sha-base-000");

    const config = provisionDomainWorktree(testDir, ledger, "billing", "run-101", mockRunner);
    expect(config.domain).toBe("billing");
    expect(config.status).toBe("active");
    expect(isDomainSyncEligible(config)).toBe(true);
  });

  test("syncDomainToGlobal detects merge conflicts and updates domain status", () => {
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "merge") {
        return { status: 1, stdout: "CONFLICT (content): Merge conflict in core.ts\n", stderr: "" };
      }
      if (argv[0] === "diff") return { status: 0, stdout: "core.ts\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const ledger = createDomainLedger("harness-main", "sha-base-000", testDir);
    ledger.domains["payments"] = {
      domain: "payments",
      worktreeId: "domain-payments",
      worktreePath: join(testDir, "payments"),
      branch: "harness--payments-run1",
      baseSha: "sha-base-000",
      headSha: "sha-pay-111",
      createdAt: new Date().toISOString(),
      status: "active",
      assignedTaskIds: [],
    };
    ledger.commits.push({
      taskId: "task-1",
      domain: "payments",
      worktreeId: "domain-payments",
      sha: "sha-pay-111",
      subject: "feat(payments): add stripe checkout",
      changedLines: 40,
      overLimit: false,
      committedAt: new Date().toISOString(),
      pushed: false,
    });

    const result = syncDomainToGlobal({
      repoRoot: testDir,
      runId: "run1",
      domain: "payments",
      ledger,
      runner: mockRunner,
    });
    expect(result.synced).toBe(false);
    expect(result.conflict).toBeDefined();
    expect(ledger.domains["payments"]?.status).toBe("conflict");
  });

  test("synchronizeAllDomains consolidates multiple domain worktrees into summary", () => {
    const mockRunner: GitRunner = () => ({ status: 0, stdout: "", stderr: "" });
    const ledger = createDomainLedger("harness-main", "sha-base-000", testDir, "main");
    ledger.domains["auth"] = {
      domain: "auth",
      worktreeId: "domain-auth",
      worktreePath: join(testDir, "auth"),
      branch: "harness--auth-run1",
      baseSha: "sha-base-000",
      headSha: "sha-auth-1",
      createdAt: new Date().toISOString(),
      status: "active",
      assignedTaskIds: [],
    };

    const summary = synchronizeAllDomains({
      repoRoot: testDir,
      runId: "run1",
      ledger,
      runner: mockRunner,
    });
    expect(summary.syncedDomains).toContain("auth");
    expect(summary.scopeIsolated).toBe(true);
  });

  test("landHermeticWorktree stages changes, rebases, pushes, and performs clean teardown", async () => {
    const mockRunner: GitRunner = (_cwd, argv) => {
      if (argv[0] === "rev-parse" && argv[1] === "HEAD")
        return { status: 0, stdout: "landed-sha-999\n", stderr: "" };
      if (argv[0] === "branch" && argv[1] === "--show-current")
        return { status: 0, stdout: "main\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };

    const wtDir = join(testDir, ".olt", "worktrees", "track-landing-lane");
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(join(wtDir, "result.txt"), "done\n", "utf8");

    const ctx: WorktreeContext = {
      trackId: "track-landing-lane",
      worktreePath: wtDir,
      branch: "track/track-landing-lane",
      baseBranch: "main",
      repoRoot: testDir,
      lockPath: join(testDir, ".olt", "worktrees", "locks", "track-landing-lane.lock"),
      createdAt: new Date().toISOString(),
    };

    const landing = await landHermeticWorktree(ctx, {
      remote: "origin",
      targetBranch: "main",
      description: "implement hermetic worktree feature",
      runner: mockRunner,
    });

    expect(landing.success).toBe(true);
    expect(landing.trackId).toBe("track-landing-lane");
    expect(landing.commitSha).toBe("landed-sha-999");
    expect(landing.cleaned).toBe(true);
    expect(landing.tornDown).toBe(true);
  });

  test("CLI commands worktreeCreate, worktreeStatus, worktreeList, and worktreeClean operate coherently", () => {
    const createRes = worktreeCreateCommand({
      track: "cli-lane-1",
      "repo-root": testDir,
      "base-branch": "main",
    });
    expect(createRes.track_id).toBe("cli-lane-1");
    expect(typeof createRes.markdown).toBe("string");

    const statusRes = worktreeStatusCommand({
      track: "cli-lane-1",
      "repo-root": testDir,
    });
    expect(statusRes.active).toBe(true);

    const listRes = worktreeListCommand({ "repo-root": testDir });
    expect(listRes.count).toBe(1);

    const cleanRes = worktreeCleanCommand({
      track: "cli-lane-1",
      "repo-root": testDir,
    });
    expect(cleanRes.count).toBe(1);

    const postStatus = worktreeStatusCommand({
      track: "cli-lane-1",
      "repo-root": testDir,
    });
    expect(postStatus.active).toBe(false);
  });
});
