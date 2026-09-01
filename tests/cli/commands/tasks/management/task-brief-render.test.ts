import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { taskBriefCommand } from "../../../../../olt/scripts/src/cli/commands/task-brief.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { TASK_ID, setupRun } from "../../fixtures/probe-fixture.ts";
import { FIXTURE_ORCH_ROOT } from "../../../../shared/chains/agent-supervisor-chain.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

describe("task:brief - Extended Rendering & Agent Briefings", () => {
  test("taskBriefCommand covers cargo/pytest gates and acceptance criteria replacement", async () => {
    const { run } = await setupRun("task-brief-cargo-gates", roots);

    transact(run, "coordinator", "set-cargo-gate-task", {}, (draft) => {
      const t = draft.tasks[TASK_ID]!;
      const graph = (draft.graph ?? { revision: 1 }) as Record<string, unknown>;
      graph.gates = [
        {
          id: "g1",
          scope: "task",
          mandatory: true,
          requirement_ids: ["req-core"],
          command: "pytest",
        },
        {
          id: "g2",
          scope: "task",
          mandatory: true,
          requirement_ids: ["req-core"],
          command: "cargo test",
        },
      ];
      draft.graph = graph;
      t.write_scope = ["src/index.ts"];
      t.target_files = undefined;
      t.acceptance_criteria = undefined;
      t.requirement_ids = [];
    });

    const result = await taskBriefCommand({
      run,
      task: TASK_ID,
    });

    expect(String(result.markdown)).toContain("bun test src/index.ts");
    expect(String(result.markdown)).toContain("Strict type safety");
  });

  test("taskBriefCommand derives bun test candidate for source files without gate commands", async () => {
    const { run } = await setupRun("task-brief-ts-fallback", roots);

    transact(run, "coordinator", "set-ts-fallback-task", {}, (draft) => {
      const t = draft.tasks[TASK_ID]!;
      const graph = (draft.graph ?? { revision: 1 }) as Record<string, unknown>;
      graph.gates = [];
      draft.graph = graph;
      t.write_scope = ["src/helper.ts"];
      t.target_files = undefined;
    });

    const result = await taskBriefCommand({
      run,
      task: TASK_ID,
    });

    expect(String(result.markdown)).toContain("bun test src/helper.ts");
  });

  test("taskBriefCommand throws INVALID_ARGUMENT when task is not found", async () => {
    const { run } = await setupRun("task-brief-missing", roots);
    await expect(
      taskBriefCommand({
        run,
        task: "non-existent-task",
      }),
    ).rejects.toThrow(/unknown task non-existent-task/);
  });

  test("taskBriefCommand resolves briefing for registered agent with parent task", async () => {
    const { run } = await setupRun("agent-brief-test", roots);

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
      "--parent-agent",
      FIXTURE_ORCH_ROOT,
      "--actor",
      FIXTURE_ORCH_ROOT,
    ]);

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-agent-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
      "--parent-agent",
      "coordinator-1",
      "--actor",
      "coordinator-1",
      "--parent-task",
      TASK_ID,
      "--model",
      "claude-3-7-sonnet",
      "--model-tier",
      "m",
      "--thinking-level",
      "high",
      "--tool",
      "Bash=shell",
    ]);

    const result = await taskBriefCommand({
      run,
      agent: "worker-agent-1",
    });

    expect(typeof result.markdown).toBe("string");
    expect(result.run_root).toBe(run);
    expect(result.grant).toBeDefined();
    expect(result.briefing).toBeDefined();
    expect(result.task_briefing).toBeDefined();

    const briefing = result.briefing as {
      agentId: string;
      role: string;
      parentTaskId?: string | null;
      writeScope?: string[];
    };
    expect(briefing.agentId).toBe("worker-agent-1");
    expect(briefing.role).toBe("implementer");
    expect(briefing.parentTaskId).toBe(TASK_ID);
    expect(briefing.writeScope).toEqual(["tests/core"]);
    expect(String(result.markdown)).toContain(
      "### 🌌 Zero-Exploration Briefing: Agent worker-agent-1 (implementer)",
    );

    const combined = await taskBriefCommand({
      run,
      task: TASK_ID,
      agent: "worker-agent-1",
    });
    expect(combined.agent_briefing).toBeDefined();
  });

  test("taskBriefCommand resolves briefing for leased, validating, and submitted tasks", async () => {
    const { run } = await setupRun("task-brief-statuses", roots);

    transact(run, "coordinator", "set-status-leased", {}, (draft) => {
      draft.tasks[TASK_ID]!.status = "leased";
    });
    const leasedRes = await taskBriefCommand({ run, task: TASK_ID });
    expect(String(leasedRes.markdown)).toContain("task:submit");

    transact(run, "coordinator", "set-status-submitted", {}, (draft) => {
      draft.tasks[TASK_ID]!.status = "submitted";
    });
    const subRes = await taskBriefCommand({ run, task: TASK_ID });
    expect(String(subRes.markdown)).toContain("task:validate-start");

    transact(run, "coordinator", "set-status-validating", {}, (draft) => {
      draft.tasks[TASK_ID]!.status = "validating";
    });
    const valRes = await taskBriefCommand({ run, task: TASK_ID });
    expect(String(valRes.markdown)).toContain("task:review");

    transact(run, "coordinator", "set-status-retry-ready", {}, (draft) => {
      draft.tasks[TASK_ID]!.status = "retry_ready";
    });
    const retryRes = await taskBriefCommand({ run, task: TASK_ID });
    expect(String(retryRes.markdown)).toContain("task:claim");
  });

  test("taskBriefCommand throws INVALID_STATE when agent holds no grant", async () => {
    const { run } = await setupRun("agent-brief-missing", roots);
    await expect(
      taskBriefCommand({
        run,
        agent: "unknown-agent",
      }),
    ).rejects.toThrow(/holds no grant/);
  });

  test("taskBriefCommand detects isolated worktree if assigned in ledger", async () => {
    const { run } = await setupRun("task-brief-worktree", roots);

    transact(run, "coordinator", "worktree-assigned", {}, (draft) => {
      draft.worktree_ledger = {
        harness_branch: "harness/test",
        base_sha: "sha-base",
        root: ".worktrees",
        worktrees: [
          {
            id: "wt-core",
            path: ".worktrees/task-core",
            branch: "task/task-core",
            base_sha: "sha-base",
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

    const result = await taskBriefCommand({
      run,
      task: TASK_ID,
      agent: "worker-wt",
      role: "implementer",
    });

    expect(typeof result.markdown).toBe("string");
    expect(result.briefing).toBeDefined();
    const briefing = result.briefing as { worktreePath?: string };
    expect(briefing.worktreePath).toBe(".worktrees/task-core");
    expect(String(result.markdown)).toContain("### 🌌 Zero-Exploration Briefing: " + TASK_ID);
    expect(String(result.markdown)).toContain("- **Isolated Worktree**: `.worktrees/task-core`");
  });

  test("execute(['task:brief', ...]) succeeds with 1-shot briefing", async () => {
    const { run } = await setupRun("cli-task-brief", roots);
    const output = await execute(["task:brief", "--run", run, "--task", TASK_ID]);

    expect(output.run_root).toBe(run);
    expect(String(output.markdown)).toContain("### 🌌 Zero-Exploration Briefing: " + TASK_ID);
  });

  test("execute(['task:brief', ...]) includes agent and role when provided", async () => {
    const { run } = await setupRun("cli-task-brief-agent", roots);
    const output = await execute([
      "task:brief",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    expect(output.run_root).toBe(run);
    expect(String(output.markdown)).toContain("Role: `implementer`");
    expect(String(output.markdown)).toContain("Agent: `worker-1`");
  });
});
