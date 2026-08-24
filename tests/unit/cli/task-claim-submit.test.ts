import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  taskClaimCommand,
  taskSubmitCommand,
} from "../../../olt/scripts/src/cli/commands/task-claim.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { TASK_ID, claimSubmitValidate, setupRun } from "./probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("task:claim / task:heartbeat / task:submit", () => {
  test("refuses an unrecognised --role", async () => {
    // taskClaimCommand checks --role before it ever opens the run root, so no capsule is needed.
    await expect(
      taskClaimCommand({
        run: mkdtempSync(join(tmpdir(), "olt-test-")),
        task: TASK_ID,
        agent: "worker-1",
        role: "reviewer",
      }),
    ).rejects.toThrow(/--role must be one of/);
  });

  test("refuses task claim by validator or completeness-critic (anti-boundary-leak rule)", async () => {
    await expect(
      taskClaimCommand({
        run: mkdtempSync(join(tmpdir(), "olt-test-")),
        task: TASK_ID,
        agent: "val-agent-1",
        role: "validator",
      }),
    ).rejects.toThrow(
      /cannot claim code implementation tasks: critics and validators are strictly prohibited from claiming code write leases/,
    );

    await expect(
      taskClaimCommand({
        run: mkdtempSync(join(tmpdir(), "olt-test-")),
        task: TASK_ID,
        agent: "critic-agent-1",
        role: "completeness-critic",
      }),
    ).rejects.toThrow(
      /cannot claim code implementation tasks: critics and validators are strictly prohibited from claiming code write leases/,
    );

    await expect(
      taskClaimCommand({
        run: mkdtempSync(join(tmpdir(), "olt-test-")),
        task: TASK_ID,
        agent: "subval-1",
        role: "sub-validator",
      }),
    ).rejects.toThrow(/cannot claim code implementation tasks/);

    await expect(
      taskClaimCommand({
        run: mkdtempSync(join(tmpdir(), "olt-test-")),
        task: TASK_ID,
        agent: "planval-1",
        role: "plan-validator",
      }),
    ).rejects.toThrow(/cannot claim code implementation tasks/);
  });

  test("claims a ready task and echoes the lease token", async () => {
    const { run } = await setupRun("claim-basic", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    expect(typeof claim.token).toBe("string");
    expect((claim.task as { status: string }).status).toBe("leased");
    expect(String(claim.markdown)).toContain(TASK_ID);
  });

  test("task:heartbeat extends a live lease and refuses a foreign/expired token elsewhere", async () => {
    const { run } = await setupRun("heartbeat", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    const beat = await execute([
      "task:heartbeat",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--token",
      claim.token as string,
    ]);
    expect((beat.task as { status: string }).status).toBe("running");
  });

  test("task:submit refuses combining --report with --files-changed/--evidence/--summary", async () => {
    // The report/summary conflict check runs right after loadRun's own-task lookup, before any
    // check on lease/claim state, so the task never needs to actually be claimed first.
    const { repo, run } = await setupRun("submit-report-conflict", roots);
    const reportPath = `${repo}/report.json`;
    await Bun.write(reportPath, JSON.stringify({ summary: "x", files_changed: [], checks: [] }));
    await expect(
      taskSubmitCommand({
        run,
        task: TASK_ID,
        agent: "worker-1",
        token: "unused-token",
        report: reportPath,
        summary: "also inline",
      }),
    ).rejects.toThrow(/cannot be combined with --files-changed/);
  });

  test("task:submit requires --summary when no --report is given", async () => {
    const { run } = await setupRun("submit-no-summary", roots);
    await expect(
      taskSubmitCommand({
        run,
        task: TASK_ID,
        agent: "worker-1",
        token: "unused-token",
      }),
    ).rejects.toThrow(/--summary is required/);
  });

  test("--no-op requires --reason, and --reason is meaningless without --no-op", async () => {
    // Both refusals run before taskSubmitCommand ever opens the run root, so neither needs a
    // capsule, let alone a claimed task.
    await expect(
      taskSubmitCommand({
        run: mkdtempSync(join(tmpdir(), "olt-test-")),
        task: TASK_ID,
        agent: "worker-1",
        token: "unused-token",
        summary: "no change needed",
        "no-op": true,
      }),
    ).rejects.toThrow(/--no-op requires --reason/);

    await expect(
      taskSubmitCommand({
        run: mkdtempSync(join(tmpdir(), "olt-test-")),
        task: TASK_ID,
        agent: "worker-1",
        token: "unused-token",
        summary: "irrelevant",
        reason: "orphan reason",
      }),
    ).rejects.toThrow(/--reason only applies together with --no-op/);
  });

  test("task:submit refuses an unknown task id", async () => {
    const { run } = await setupRun("submit-unknown-task", roots);
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        "task-ghost",
        "--agent",
        "worker-1",
        "--token",
        "whatever",
        "--summary",
        "x",
      ]),
    ).rejects.toThrow(/unknown task task-ghost/);
  });

  test("a full claim → submit → validate-start round trip via --files-changed and --evidence", async () => {
    const { repo, run } = await setupRun("full-round-trip", roots);
    const validation = await claimSubmitValidate(repo, run);
    expect(typeof validation.token).toBe("string");
    expect((validation.task as { status: string }).status).toBe("validating");
  });

  test("task:claim rejects orchestrator and logs defect to capsule directory", async () => {
    const { run } = await setupRun("claim-orch-confinement", roots);
    try {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "orch-lead",
        "--role",
        "orchestrator",
      ]);
      expect(true).toBeFalse();
    } catch (err: unknown) {
      const error = err as { code?: string; message: string };
      expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(error.message).toContain(
        "Orchestrators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
      );
    }

    const defectsFile = `${run}/defects.jsonl`;
    const defectsExist = await Bun.file(defectsFile).exists();
    expect(defectsExist).toBeTrue();
    const contents = await Bun.file(defectsFile).text();
    expect(contents).toContain("role_confinement_violation");
    expect(contents).toContain("orch-lead");
  });

  test("task:claim rejects coordinator and logs defect to capsule directory", async () => {
    const { run } = await setupRun("claim-coord-confinement", roots);
    try {
      await execute([
        "task:claim",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "coord-dispatcher",
        "--role",
        "coordinator",
      ]);
      expect(true).toBeFalse();
    } catch (err: unknown) {
      const error = err as { code?: string; message: string };
      expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(error.message).toContain(
        "Coordinators are mechanically confined from claiming code execution tasks. Dispatch Tier 3 Implementers via invoke_subagent.",
      );
    }

    const defectsFile = `${run}/defects.jsonl`;
    const defectsExist = await Bun.file(defectsFile).exists();
    expect(defectsExist).toBeTrue();
    const contents = await Bun.file(defectsFile).text();
    expect(contents).toContain("role_confinement_violation");
    expect(contents).toContain("coord-dispatcher");
  });

  test("task:claim with explicit --lease-duration and --lease-seconds", async () => {
    const { run } = await setupRun("claim-duration", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--lease-duration",
      "3600",
    ]);
    expect(claim.token).toBeDefined();

    const { run: run2 } = await setupRun("claim-seconds", roots);
    const claim2 = await execute([
      "task:claim",
      "--run",
      run2,
      "--task",
      TASK_ID,
      "--agent",
      "worker-2",
      "--role",
      "implementer",
      "--lease-seconds",
      "1800",
    ]);
    expect(claim2.token).toBeDefined();
  });

  test("task:claim with worktree isolation and git metadata command variants", async () => {
    const { repo, run } = await setupRun("claim-worktree-git", roots, {
      worktree_isolation: true,
      commit_per_subphase: true,
    });

    const { spawnSync } = await import("node:child_process");
    spawnSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "test@test.test"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repo });
    spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repo });
    // Also place config in all possible parent directories
    const { resolve } = await import("node:path");
    await Bun.write(
      join(repo, "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, commit_per_subphase: true }),
    );
    await Bun.write(
      join(repo, ".olt", "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, commit_per_subphase: true }),
    );
    await Bun.write(
      join(resolve(run, "..", ".."), "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, commit_per_subphase: true }),
    );

    const wtDir = join(repo, ".worktrees", "task-core");
    await Bun.write(join(wtDir, "tests/unit/core/probe-target.ts"), "export const a = 1;\n");

    // Mock worktree assignment in state
    const { transact } = await import("../../../olt/scripts/src/engine/store/index.ts");
    transact(run, "coordinator", "worktree-assigned", {}, (draft) => {
      draft.worktree_ledger = {
        harness_branch: "harness/test",
        base_sha: "sha-base-123",
        root: ".worktrees",
        worktrees: [
          {
            id: "wt-core",
            path: wtDir,
            branch: "task/task-core",
            base_sha: "sha-base-123",
            created_at: new Date().toISOString(),
          },
        ],
        assignments: [
          {
            task_id: TASK_ID,
            worktree_id: "wt-core",
            wave: 1,
          },
        ],
        commits: [],
      };
    });

    const mockGitSuccess = () => ({
      status: 0,
      bytes: Buffer.from("abc123def456\n"),
      command: "git rev-parse",
    });

    const claim = await taskClaimCommand(
      {
        run,
        task: TASK_ID,
        agent: "worker-wt",
        role: "implementer",
      },
      { repositoryGitCommand: mockGitSuccess },
    );
    expect(claim.token).toBeDefined();
    expect(claim.worktree_path).toBeDefined();

    // Test git command returning status !== 0
    const mockGitFailure = () => ({
      status: 1,
      bytes: Buffer.from(""),
      command: "git rev-parse",
    });
    const { repo: repo3, run: run3 } = await setupRun("claim-git-fail", roots);
    spawnSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: repo3 });
    spawnSync("git", ["config", "user.email", "test@test.test"], { cwd: repo3 });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repo3 });
    spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repo3 });
    const claim3 = await taskClaimCommand(
      {
        run: run3,
        task: TASK_ID,
        agent: "worker-3",
        role: "implementer",
      },
      { repositoryGitCommand: mockGitFailure },
    );
    expect(claim3.token).toBeDefined();

    // Test git command throwing
    const mockGitThrow = () => {
      throw new Error("git error");
    };
    const { repo: repo4, run: run4 } = await setupRun("claim-git-throw", roots);
    spawnSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: repo4 });
    spawnSync("git", ["config", "user.email", "test@test.test"], { cwd: repo4 });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repo4 });
    spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repo4 });
    const claim4 = await taskClaimCommand(
      {
        run: run4,
        task: TASK_ID,
        agent: "worker-4",
        role: "implementer",
      },
      { repositoryGitCommand: mockGitThrow },
    );
    expect(claim4.token).toBeDefined();
  });

  test("task:submit with --no-op and --reason when write scope is unchanged", async () => {
    const { repo, run } = await setupRun("submit-noop", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    const runGate = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "worker-1",
      "--task",
      TASK_ID,
      "--",
      "bun",
      "gate-core.ts",
    ]);

    const submit = await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--token",
      claim.token as string,
      "--summary",
      "Verified bug is already fixed in upstream",
      "--evidence",
      runGate.command_id as string,
      "--no-op",
      "--reason",
      "Already fixed in core schema",
    ]);

    expect((submit.task as { status: string }).status).toBe("submitted");
  });

  test("task:submit with --report file payload", async () => {
    const { repo, run } = await setupRun("submit-report-file", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    const runGate = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "worker-1",
      "--task",
      TASK_ID,
      "--",
      "bun",
      "gate-core.ts",
    ]);

    const { loadRun } = await import("../../../olt/scripts/src/engine/store/index.ts");
    const loadedTask = (loadRun(run).state.tasks as Record<string, { requirement_ids?: string[] }>)[
      TASK_ID
    ];

    const reportPath = join(repo, "custom-report.json");
    await Bun.write(
      reportPath,
      JSON.stringify({
        summary: "Implemented via custom report file",
        files_changed: ["tests/unit/core/probe-target.ts"],
        requirement_ids: loadedTask?.requirement_ids ?? [],
        checks: [{ command_id: runGate.command_id as string }],
        evidence: [{ command_id: runGate.command_id as string }],
      }),
    );

    // Modify file
    await Bun.write(
      join(repo, "tests/unit/core/probe-target.ts"),
      "export const updated = true;\n",
    );

    const submit = await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--token",
      claim.token as string,
      "--report",
      reportPath,
    ]);

    expect((submit.task as { status: string }).status).toBe("submitted");
  });

  test("task:submit with worktree subphase commit and warning", async () => {
    const { repo, run } = await setupRun("submit-worktree-commit", roots, {
      worktree_isolation: true,
      commit_per_subphase: true,
    });

    const { resolve } = await import("node:path");
    await Bun.write(
      join(repo, "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, commit_per_subphase: true }),
    );
    await Bun.write(
      join(repo, ".olt", "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, commit_per_subphase: true }),
    );
    await Bun.write(
      join(resolve(run, "..", ".."), "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, commit_per_subphase: true }),
    );

    const wtPath = join(repo, ".worktrees", "task-core");
    await Bun.write(join(wtPath, "tests/unit/core/probe-target.ts"), "export const a = 1;\n");
    await Bun.write(join(repo, "tests/unit/core/probe-target.ts"), "export const a = 1;\n");

    const { transact } = await import("../../../olt/scripts/src/engine/store/index.ts");
    transact(run, "coordinator", "worktree-assigned", {}, (draft) => {
      draft.worktree_ledger = {
        harness_branch: "harness/test",
        base_sha: "sha-base-123",
        root: ".worktrees",
        worktrees: [
          {
            id: "wt-core",
            path: wtPath,
            branch: "task/task-core",
            base_sha: "sha-base-123",
            created_at: new Date().toISOString(),
          },
        ],
        assignments: [
          {
            task_id: TASK_ID,
            worktree_id: "wt-core",
            wave: 1,
          },
        ],
        commits: [],
      };
    });

    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    const runGate = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "worker-1",
      "--task",
      TASK_ID,
      "--",
      "bun",
      "gate-core.ts",
    ]);

    await Bun.write(join(wtPath, "tests/unit/core/probe-target.ts"), "export const a = 2;\n");
    await Bun.write(join(repo, "tests/unit/core/probe-target.ts"), "export const a = 2;\n");

    const mockRunner = () => ({
      status: 0,
      stdout: "",
      stderr: "",
    });

    const submit = await taskSubmitCommand(
      {
        run,
        task: TASK_ID,
        agent: "worker-1",
        token: claim.token as string,
        summary: "Worktree commit subphase test",
        "files-changed": "tests/unit/core/probe-target.ts",
        evidence: runGate.command_id as string,
      },
      {
        worktreeGitRunner: mockRunner,
      },
    );

    expect((submit.task as { status: string }).status).toBe("submitted");
  });

  test("taskSubmitCommand and taskReleaseCommand from task-ops.ts wrapper", async () => {
    const { repo, run } = await setupRun("task-ops-wrappers", roots);
    const { taskSubmitCommand: opsSubmit, taskReleaseCommand: opsRelease } =
      await import("../../../olt/scripts/src/cli/commands/task-ops.ts");

    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    // Release task via task-ops wrapper
    const releaseRes = opsRelease({
      run,
      task: TASK_ID,
      agent: "worker-1",
      token: claim.token as string,
      reason: "releasing for ops test",
    });
    expect((releaseRes.task as { status: string }).status).toBe("retry_ready");

    // Re-claim and submit via task-ops wrapper
    const claim2 = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    const runGate = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "worker-1",
      "--task",
      TASK_ID,
      "--",
      "bun",
      "gate-core.ts",
    ]);

    await Bun.write(
      join(repo, "tests/unit/core/probe-target.ts"),
      "export const opsDone = true;\n",
    );

    const submitRes = await opsSubmit({
      run,
      task: TASK_ID,
      agent: "worker-1",
      token: claim2.token as string,
      summary: "submitted via ops wrapper",
      "files-changed": "tests/unit/core/probe-target.ts",
      evidence: runGate.command_id as string,
    });
    expect((submitRes.task as { status: string }).status).toBe("submitted");
  });
});
