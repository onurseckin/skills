import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/index.ts";
import { taskClaimCommand } from "../../../../../olt/scripts/src/cli/commands/task-claim.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { TASK_ID, setupRun } from "../../fixtures/probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function installRuntimeMetadata(run: string, agent: string): Promise<void> {
  writeAgentMetadata(
    createAgentMetadata({
      agent_id: agent,
      role: "implementer",
      allowed_read_scope: ["tests/core"],
    }),
    run,
  );
}

describe("task:heartbeat and task:claim Leases", () => {
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
    expect(String(beat.markdown)).toContain("Heartbeat Acknowledged");

    await expect(
      execute([
        "task:heartbeat",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "worker-1",
        "--token",
        "invalid-token",
      ]),
    ).rejects.toThrow();
  });

  test("task:claim surfaces defect persistence failure and never reports a recorded violation", async () => {
    const { repo, run } = await setupRun("claim-persistence-failure", roots);
    const external = join(repo, "external-defects.jsonl");
    const externalBytes = '{"id":"external-sentinel"}\n';
    writeFileSync(external, externalBytes, "utf8");
    symlinkSync(external, join(run, "defects.jsonl"));

    let caught: unknown;
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
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    expect((caught as HarnessError).code).toBe("INTEGRITY");
    expect(readFileSync(external, "utf8")).toBe(externalBytes);
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

    spawnSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "test@test.test"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repo });
    spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repo });

    mkdirSync(join(repo, ".olt"), { recursive: true });
    writeFileSync(
      join(repo, "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, commit_per_subphase: true }),
    );
    writeFileSync(
      join(repo, ".olt", "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, commit_per_subphase: true }),
    );
    writeFileSync(
      join(resolve(run, "..", ".."), "harness.config.json"),
      JSON.stringify({ worktree_isolation: true, commit_per_subphase: true }),
    );

    const wtDir = join(repo, ".worktrees", "task-core");
    mkdirSync(join(wtDir, "tests/core"), { recursive: true });
    writeFileSync(join(wtDir, "tests/core/probe-target.ts"), "export const a = 1;\n");

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
  }, 20000);

  test("task:submit with --no-op and --reason when write scope is unchanged", async () => {
    const { run } = await setupRun("submit-noop", roots);
    await installRuntimeMetadata(run, "worker-1");
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
});
