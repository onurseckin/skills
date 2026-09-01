import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { branchClaimCommand } from "../../../../../olt/scripts/src/cli/commands/branch-ops.ts";
import {
  branchCapsule,
  branchesOf,
  cleanupRoots,
  openBranchVia,
  taskOf,
  type BranchFixture,
} from "../../../../branch/index.ts";

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

describe("branch:open", () => {
  test("creates a branch, links it to parent task, and registers sub-tasks in draft mode", async () => {
    const fixture = await withFixture("branch-open-basic");
    const result = await openBranchVia(fixture, {
      subTasks: [
        { id: "S-1", label: "Part A", scopes: ["src/one/parser"] },
        { id: "S-2", label: "Part B", scopes: ["src/one/lexer"] },
      ],
    });

    expect(result.branch_id).toBeDefined();
    const branches = branchesOf(fixture.run);
    const branch = branches.find((b) => b.id === (result.branch_id as string));
    expect(branch).toBeDefined();
    expect(branch?.sub_tasks.map((s) => s.id)).toEqual(["S-1", "S-2"]);

    const task = taskOf(fixture.run, "task-1") as { status?: string };
    expect(task.status).toBe("branched");
  });

  test("rejects sub-tasks whose scope exceeds the parent task scope", async () => {
    const fixture = await withFixture("branch-open-scope-violation");
    await expect(
      openBranchVia(fixture, {
        subTasks: [{ id: "S-1", label: "Other", scopes: ["src/two"] }],
      }),
    ).rejects.toThrow("write scope escapes the parent scope");
  });

  test("rejects branching a task whose status is not leased", async () => {
    const fixture = await withFixture("branch-open-wrong-status");
    await execute([
      "task:abandon",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
      "--reason",
      "not leased",
    ]);

    await expect(
      openBranchVia(fixture, {
        subTasks: [{ id: "S-1", label: "Part", scopes: ["src/one/parser"] }],
      }),
    ).rejects.toThrow("cannot open a branch");
  });
});

describe("branch:claim", () => {
  test("sub-agent claims an unblocked sub-task and receives bearer token", async () => {
    const fixture = await withFixture("branch-claim-basic");
    const opened = await openBranchVia(fixture, {
      subTasks: [{ id: "S-1", label: "Part A", scopes: ["src/one/parser"] }],
    });
    await registerSubAgent(fixture, "sub-1", "worker-1", "S-1");

    const result = await execute([
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

    expect(result.token).toBeDefined();
    const branch = branchesOf(fixture.run).find((b) => b.id === (opened.branch_id as string));
    expect(branch?.sub_tasks.find((s) => s.id === "S-1")?.status).toBe("claimed");
  });

  test("rejects non-sub roles from claiming branch tasks", async () => {
    const base = {
      run: "run-mock",
      repo: "/virtual/cli/olt-test-fake",
      branch: "unused-branch",
      "sub-task": "S-1",
      agent: "sub-1",
    };
    await expect(branchClaimCommand({ ...base, role: "coordinator" })).rejects.toThrow(
      "--role must be one of",
    );
    await expect(branchClaimCommand({ ...base, role: "not-a-real-role" })).rejects.toThrow(
      "--role must be one of",
    );
  });
});
