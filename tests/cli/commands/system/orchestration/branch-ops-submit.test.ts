import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  branchCapsule,
  branchesOf,
  openBranchVia,
  taskOf,
  type BranchFixture,
} from "../../../../branch/index.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function withFixture(name: string): Promise<BranchFixture> {
  return branchCapsule(roots, name);
}

async function registerSubAgent(
  fixture: BranchFixture,
  agent: string,
  parentAgent: string,
  parentTask?: string,
): Promise<void> {
  const args = [
    "agent:register",
    "--run",
    fixture.run,
    "--agent",
    agent,
    "--role",
    "sub-implementer",
    "--host",
    "claude-code",
    "--parent-agent",
    parentAgent,
    "--actor",
    parentAgent,
  ];
  if (parentTask) args.push("--parent-task", parentTask);
  await execute(args);
}

describe("branch:submit and branch:collect", () => {
  test("submit records what the sub-agent reports, then collect resumes the top-level parent task", async () => {
    const fixture = await withFixture("branch-submit-collect");
    const opened = await openBranchVia(fixture, {
      subTasks: [
        { id: "S-1", label: "Sub 1", scopes: ["src/one/parser"] },
        { id: "S-2", label: "Sub 2", scopes: ["src/one/lexer"] },
      ],
    });
    await registerSubAgent(fixture, "sub-1", "worker-1", "S-1");
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
    ]);
    const submitted = await execute([
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
      "Subtask S-1 finished cleanly",
    ]);

    expect(submitted.branch).toBeDefined();
    const branch = branchesOf(fixture.run).find((b) => b.id === (opened.branch_id as string));
    expect(branch?.sub_tasks.find((s) => s.id === "S-1")?.status).toBe("submitted");

    await registerSubAgent(fixture, "sub-2", "worker-1", "S-2");
    const claimed2 = await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-2",
      "--agent",
      "sub-2",
      "--role",
      "sub-implementer",
    ]);
    await execute([
      "branch:submit",
      "--run",
      fixture.run,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-2",
      "--agent",
      "sub-2",
      "--token",
      String(claimed2.token),
      "--summary",
      "Subtask S-2 finished cleanly",
    ]);

    const collectedAll = await execute([
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
      "all subtasks completed",
    ]);

    expect(collectedAll.branch).toBeDefined();
    const parent = taskOf(fixture.run, "task-1") as { status?: string };
    expect(parent.status).toBe("running");
  });

  test("rejects submission with invalid bearer token", async () => {
    const fixture = await withFixture("branch-submit-bad-token");
    const opened = await openBranchVia(fixture, {
      subTasks: [{ id: "S-1", label: "Sub 1", scopes: ["src/one/parser"] }],
    });
    await registerSubAgent(fixture, "sub-1", "worker-1", "S-1");
    await execute([
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
    ]);

    await expect(
      execute([
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
        "wrong-token",
        "--summary",
        "done",
      ]),
    ).rejects.toThrow("lease identity or token is invalid");
  });
});

describe("branch:status", () => {
  test("returns branch summaries and progress breakdown", async () => {
    const fixture = await withFixture("branch-status-summary");
    const opened = await openBranchVia(fixture, {
      subTasks: [
        { id: "S-1", label: "Sub 1", scopes: ["src/one/parser"] },
        { id: "S-2", label: "Sub 2", scopes: ["src/one/lexer"] },
      ],
    });

    const status = await execute([
      "branch:status",
      "--run",
      fixture.run,
      "--branch",
      String(opened.branch_id),
    ]);

    expect(status.branches).toBeDefined();
    expect((status.branches as unknown[]).length).toBe(1);

    const all = await execute(["branch:status", "--run", fixture.run]);
    expect(all.total_branches).toBe(1);
  });
});
