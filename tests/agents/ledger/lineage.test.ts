import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { agentListCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import type { AgentRole } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../olt/scripts/src/workflow/agents/grants.ts";
import { knownTaskIds } from "../../../olt/scripts/src/workflow/agents/ledger.ts";
import {
  ancestorChain,
  childrenOf,
  taskLineage,
} from "../../../olt/scripts/src/workflow/agents/lineage.ts";
import { cleanupVirtualAgentsFS, setupVirtualAgentsFS } from "../fixture.ts";
import { ledgerOf, registerCoordinator, seededRun } from "../grants/agent-grant-fixtures.ts";

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

function register(
  run: string,
  agent: string,
  role: AgentRole,
  parentAgent: string,
  parentTask: string,
): void {
  registerAgentGrant({
    runRoot: run,
    agentId: agent,
    role,
    parentAgentId: parentAgent,
    parentTaskId: parentTask,
    host: "claude-code",
    authority: { kind: "verified_parent", actorId: parentAgent },
    maxAgents: 50,
    telemetry: {},
  });
}

function deployedRun(name: string): string {
  const run = seededRun(import.meta.path, name);
  registerCoordinator(run);
  register(run, "impl-1", "implementer", "coordinator-1", "task-1");
  register(run, "val-1", "validator", "coordinator-1", "task-1");
  register(run, "sub-1", "sub-investigator", "impl-1", "task-1");
  register(run, "impl-2", "implementer", "coordinator-1", "task-2");
  return run;
}

describe("agent lineage", () => {
  test("answers who worked a task and under whom", () => {
    const run = deployedRun("lineage-task");
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

  test("serves the lineage and the roster through agent:list", () => {
    const run = deployedRun("lineage-cli");

    const lineage = agentListCommand({ run, task: "task-1" });
    expect(String(lineage.markdown)).toContain("### Task Lineage: task-1");
    expect(String(lineage.markdown)).toContain("`impl-1` ← `coordinator-1`");

    const roster = agentListCommand({ run });
    expect(roster.active_grants).toBe(5);
    expect(roster.released_grants).toBe(0);
    expect(String(roster.markdown)).toContain("### Deployed Agents");

    releaseAgentGrant({
      runRoot: run,
      agentId: "sub-1",
      actor: "sub-1",
      reason: "lineage check done",
    });
    const afterRelease = agentListCommand({ run });
    expect(afterRelease.active_grants).toBe(4);
    expect(String(afterRelease.markdown)).not.toContain("`sub-1`");
    const withReleased = agentListCommand({ run, all: true });
    expect(String(withReleased.markdown)).toContain("`sub-1`");
  });

  test("reports an empty lineage rather than guessing at one", () => {
    const run = seededRun(import.meta.path, "lineage-empty");
    const lineage = agentListCommand({ run, task: "task-1" });
    expect(String(lineage.markdown)).toContain("none registered against this task");
    const roster = agentListCommand({ run });
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
