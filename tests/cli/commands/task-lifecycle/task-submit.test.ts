import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { createAgentMetadata, writeAgentMetadata } from "../../../../olt/scripts/src/runtime/index.ts";
import { taskSubmitCommand } from "../../../../olt/scripts/src/cli/commands/task-claim.ts";
import { loadRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";
import { TASK_ID, setupRun } from "../fixtures/probe-fixture.ts";

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

describe("task:submit - Completion & Worktree Commits", () => {
  test("task:submit with --report file payload", async () => {
    const { repo, run } = await setupRun("submit-report-file", roots);
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

    const loadedTask = (loadRun(run).state.tasks as Record<string, { requirement_ids?: string[] }>)[
      TASK_ID
    ];

    const reportPath = join(repo, "custom-report.json");
    await Bun.write(
      reportPath,
      JSON.stringify({
        summary: "Implemented via custom report file",
        files_changed: ["tests/core/probe-target.ts"],
        requirement_ids: loadedTask?.requirement_ids ?? [],
        checks: [{ command_id: runGate.command_id as string }],
        evidence: [{ command_id: runGate.command_id as string }],
      }),
    );

    await Bun.write(
      join(repo, "tests/core/probe-target.ts"),
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
    await installRuntimeMetadata(run, "worker-1");

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
    await Bun.write(join(wtPath, "tests/core/probe-target.ts"), "export const a = 1;\n");
    await Bun.write(join(repo, "tests/core/probe-target.ts"), "export const a = 1;\n");

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

    await Bun.write(join(wtPath, "tests/core/probe-target.ts"), "export const a = 2;\n");
    await Bun.write(join(repo, "tests/core/probe-target.ts"), "export const a = 2;\n");

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
        "files-changed": "tests/core/probe-target.ts",
        evidence: runGate.command_id as string,
      },
      {
        worktreeGitRunner: mockRunner,
      },
    );

    expect((submit.task as { status: string }).status).toBe("submitted");
  }, 20000);

  test("taskSubmitCommand and taskReleaseCommand from task-ops.ts wrapper", async () => {
    const { repo, run } = await setupRun("task-ops-wrappers", roots);
    await installRuntimeMetadata(run, "worker-1");
    const { taskSubmitCommand: opsSubmit, taskReleaseCommand: opsRelease } =
      await import("../../../../olt/scripts/src/cli/commands/task-ops.ts");

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

    const releaseRes = opsRelease({
      run,
      task: TASK_ID,
      agent: "worker-1",
      token: claim.token as string,
      reason: "releasing for ops test",
    });
    expect((releaseRes.task as { status: string }).status).toBe("retry_ready");

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
      join(repo, "tests/core/probe-target.ts"),
      "export const opsDone = true;\n",
    );

    const submitRes = await opsSubmit({
      run,
      task: TASK_ID,
      agent: "worker-1",
      token: claim2.token as string,
      summary: "submitted via ops wrapper",
      "files-changed": "tests/core/probe-target.ts",
      evidence: runGate.command_id as string,
    });
    expect((submitRes.task as { status: string }).status).toBe("submitted");
  });
});
