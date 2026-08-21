import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  branchCapsule,
  branchesOf,
  cleanupRoots,
  openBranchVia,
  type BranchFixture,
} from "../unit/branch/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

function register(
  fixture: BranchFixture,
  agent: string,
  role: string,
): Promise<Record<string, unknown>> {
  return execute([
    "agent:register",
    "--run",
    fixture.run,
    "--agent",
    agent,
    "--role",
    role,
    "--host",
    "claude-code",
    ...(agent === "coordinator-1"
      ? []
      : ["--parent-agent", "coordinator-1", "--parent-task", "task-1"]),
  ]);
}

describe("branch:open against the agent budget", () => {
  test("charges the whole branch up front rather than failing mid-dispatch", async () => {
    const fixture = await branchCapsule(roots, "branch-budget", { max_agents: 3 });
    await register(fixture, "coordinator-1", "coordinator");
    await register(fixture, "worker-1", "implementer");

    await expect(
      openBranchVia(fixture, {
        subTasks: [
          { id: "S-1", label: "Parser", scopes: ["src/one/parser"] },
          { id: "S-2", label: "Lexer", scopes: ["src/one/lexer"] },
        ],
      }),
    ).rejects.toThrow(
      "max_agents budget of 3 is exhausted: 2 grants already issued and this needs 2 more; raise max_agents or narrow the work",
    );
    expect(branchesOf(fixture.run)).toHaveLength(0);
  });

  test("opens the branch that fits inside what is left", async () => {
    const fixture = await branchCapsule(roots, "branch-budget-fits", { max_agents: 3 });
    await register(fixture, "coordinator-1", "coordinator");
    await register(fixture, "worker-1", "implementer");

    const opened = await openBranchVia(fixture, {
      subTasks: [{ id: "S-1", label: "Parser", scopes: ["src/one/parser"] }],
    });
    expect(opened.branch_id).toBeString();
    expect(branchesOf(fixture.run)).toHaveLength(1);
  });
});
