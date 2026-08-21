import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { workflowPort } from "../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts";
import { completionIssues } from "../../orchestrating-long-tasks/scripts/src/workflow/completion/completion-state.ts";
import { openBranchIssues } from "../../orchestrating-long-tasks/scripts/src/workflow/branch/completion-blockers.ts";
import { branchCapsule, branchChain, cleanupRoots, openBranchVia } from "../unit/branch/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

describe("an uncollected branch blocks completion", () => {
  test("run:complete refuses while the branch is open", async () => {
    const fixture = await branchCapsule(roots, "branch-completion");
    const opened = await openBranchVia(fixture);
    const blocker = `branch ${String(opened.branch_id)} on task-1 at depth 1 is open, not collected`;

    expect(completionIssues(workflowPort(fixture.run).read())).toContain(blocker);
    await expect(
      execute([
        "run:complete",
        "--run",
        fixture.run,
        "--actor",
        "coordinator",
        // The branch blocker fires during completeRun's preflight, ahead of the token check, so
        // an unrelated value is enough to satisfy the CLI's required-flag gate for this test.
        "--auth-token",
        "irrelevant-branch-blocks-first",
      ]),
    ).rejects.toThrow(blocker);
  });

  test("blocks on an uncollected branch however deep it sits", async () => {
    const fixture = await branchCapsule(roots, "branch-completion-deep");
    const chain = await branchChain(fixture, 3);
    const deepest = chain[2]!;
    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      deepest.branchId,
      "--sub-task",
      deepest.subTaskId,
      "--agent",
      deepest.agent,
      "--token",
      deepest.token,
      "--summary",
      "the deepest fix landed",
    ]);
    const blocker = `branch ${deepest.branchId} on ${chain[1]!.subTaskId} at depth 3 is open, not collected`;

    expect(completionIssues(workflowPort(fixture.run).read())).toContain(blocker);
    await expect(
      execute([
        "run:complete",
        "--run",
        fixture.run,
        "--actor",
        "coordinator",
        // The branch blocker fires during completeRun's preflight, ahead of the token check, so
        // an unrelated value is enough to satisfy the CLI's required-flag gate for this test.
        "--auth-token",
        "irrelevant-branch-blocks-first",
      ]),
    ).rejects.toThrow(blocker);
  }, 20_000);

  test("stops blocking once the branch is collected", async () => {
    const fixture = await branchCapsule(roots, "branch-completion-clear");
    const opened = await openBranchVia(fixture);
    const claimed = await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-1",
      "--agent",
      "sub-1",
      "--role",
      "sub-implementer",
      "--lease-seconds",
      "600",
    ]);
    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-1",
      "--agent",
      "sub-1",
      "--token",
      String(claimed.token),
      "--summary",
      "done",
    ]);
    await execute([
      "branch:collect",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(opened.branch_id),
      "--agent",
      "worker-1",
      "--token",
      fixture.token,
      "--summary",
      "collected",
    ]);

    expect(
      completionIssues(workflowPort(fixture.run).read()).filter((issue) =>
        issue.startsWith("branch "),
      ),
    ).toEqual([]);
  });

  test("an abandoned branch is closed, not outstanding", () => {
    expect(
      openBranchIssues({
        branches: [
          {
            id: "B-1",
            parent_task_id: "task-1",
            parent_agent_id: "worker-1",
            reason: "why",
            depth: 1,
            status: "abandoned",
            opened_at: "2026-08-19T00:00:00.000Z",
            sub_tasks: [{ id: "S-1", label: "One", write_scope: ["src/one"], status: "abandoned" }],
          },
        ],
      }),
    ).toEqual([]);
  });
});
