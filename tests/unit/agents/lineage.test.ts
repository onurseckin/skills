import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { knownTaskIds } from "../../../orchestrating-long-tasks/scripts/src/workflow/agents/ledger.ts";
import {
  ancestorChain,
  childrenOf,
  taskLineage,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/agents/lineage.ts";
import { cleanupRoots, compiledCapsule, ledgerOf, registerCoordinator } from "./fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

async function register(
  run: string,
  agent: string,
  role: string,
  parentAgent: string,
  parentTask: string,
): Promise<void> {
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    agent,
    "--role",
    role,
    "--host",
    "claude-code",
    "--parent-agent",
    parentAgent,
    "--parent-task",
    parentTask,
  ]);
}

async function deployedRun(name: string): Promise<string> {
  const run = await compiledCapsule(roots, name);
  await registerCoordinator(run);
  await register(run, "impl-1", "implementer", "coordinator-1", "task-1");
  await register(run, "val-1", "validator", "coordinator-1", "task-1");
  await register(run, "sub-1", "sub-investigator", "impl-1", "task-1");
  await register(run, "impl-2", "implementer", "coordinator-1", "task-2");
  return run;
}

describe("agent lineage", () => {
  test("answers who worked a task and under whom", async () => {
    const run = await deployedRun("lineage-task");
    const ledger = ledgerOf(run);

    const lineage = taskLineage(ledger, "task-1");
    expect(lineage.agents.map((node) => node.agent_id)).toEqual(["impl-1", "val-1", "sub-1"]);
    expect(lineage.agents.map((node) => node.depth)).toEqual([0, 0, 1]);
    expect(lineage.agents.at(-1)?.ancestors).toEqual(["impl-1", "coordinator-1"]);

    expect(taskLineage(ledger, "task-2").agents.map((node) => node.agent_id)).toEqual(["impl-2"]);
    expect(taskLineage(ledger, "task-404").agents).toEqual([]);
    expect(ancestorChain(ledger, "coordinator-1")).toEqual([]);
    expect(childrenOf(ledger, "coordinator-1").map((grant) => grant.id)).toEqual([
      "impl-1",
      "val-1",
      "impl-2",
    ]);
  });

  test("serves the lineage and the roster through agent:list", async () => {
    const run = await deployedRun("lineage-cli");

    const lineage = await execute(["agent:list", "--run", run, "--task", "task-1"]);
    expect(String(lineage.markdown)).toContain("### Task Lineage: task-1");
    expect(String(lineage.markdown)).toContain("`impl-1` ← `coordinator-1`");

    const roster = await execute(["agent:list", "--run", run]);
    expect(roster.active_grants).toBe(5);
    expect(roster.released_grants).toBe(0);
    expect(String(roster.markdown)).toContain("### Deployed Agents");

    await execute(["agent:release", "--run", run, "--agent", "sub-1"]);
    const afterRelease = await execute(["agent:list", "--run", run]);
    expect(afterRelease.active_grants).toBe(4);
    expect(String(afterRelease.markdown)).not.toContain("`sub-1`");
    const withReleased = await execute(["agent:list", "--run", run, "--all"]);
    expect(String(withReleased.markdown)).toContain("`sub-1`");
  });

  test("reports an empty lineage rather than guessing at one", async () => {
    const run = await compiledCapsule(roots, "lineage-empty");
    const lineage = await execute(["agent:list", "--run", run, "--task", "task-1"]);
    expect(String(lineage.markdown)).toContain("none registered against this task");
    const roster = await execute(["agent:list", "--run", run]);
    expect(roster.active_grants).toBe(0);
  });

  test("accepts branch sub-task ids as bindable tasks", () => {
    const state = {
      tasks: { "task-1": { id: "task-1" } },
      branches: [{ id: "B-1", sub_tasks: [{ id: "task-1.a" }, { id: "task-1.b" }] }],
    };
    expect([...knownTaskIds(state)]).toEqual(["task-1", "task-1.a", "task-1.b"]);
    expect([...knownTaskIds({ tasks: {} })]).toEqual([]);
  });
});
