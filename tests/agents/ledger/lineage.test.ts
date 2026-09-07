import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { agentListCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import type { AgentGrantRecord, AgentRole } from "../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
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
import {
  cleanupVirtualAgentsFS,
  getVirtualAgentsFS,
  scratchRoot,
  setupVirtualAgentsFS,
} from "../fixture.ts";
import { ledgerOf, registerCoordinator, seededRun } from "../grants/agent-grant-fixtures.ts";

beforeAll(() => {
  setupVirtualAgentsFS();
  deployedRun("warmup");
  cleanupVirtualAgentsFS();
});

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

function sampleLedger(): AgentGrantRecord[] {
  return [
    {
      id: "coordinator-1",
      role: "coordinator",
      parent_agent_id: null,
      parent_task_id: null,
      host: "claude-code",
      granted_at: "2026-08-19T00:00:00.000Z",
      status: "active",
    },
    {
      id: "impl-1",
      role: "implementer",
      parent_agent_id: "coordinator-1",
      parent_task_id: "task-1",
      host: "claude-code",
      granted_at: "2026-08-19T00:00:00.000Z",
      status: "active",
    },
    {
      id: "val-1",
      role: "validator",
      parent_agent_id: "coordinator-1",
      parent_task_id: "task-1",
      host: "claude-code",
      granted_at: "2026-08-19T00:00:00.000Z",
      status: "active",
    },
    {
      id: "sub-1",
      role: "sub-investigator",
      parent_agent_id: "impl-1",
      parent_task_id: "task-1",
      host: "claude-code",
      granted_at: "2026-08-19T00:00:00.000Z",
      status: "active",
    },
    {
      id: "impl-2",
      role: "implementer",
      parent_agent_id: "coordinator-1",
      parent_task_id: "task-2",
      host: "claude-code",
      granted_at: "2026-08-19T00:00:00.000Z",
      status: "active",
    },
  ] as AgentGrantRecord[];
}

function deployedRun(name: string): string {
  const root = scratchRoot(import.meta.path, name);
  const run = initRun(root, name, new Uint8Array(0), "file", true);
  transact(run, "test-setup", "seed-graph-and-agents", {}, (draft) => {
    draft.tasks = { "task-1": { id: "task-1" }, "task-2": { id: "task-2" } };
    draft.agents = sampleLedger();
  });
  return run;
}

describe("agent lineage", () => {
  test("answers who worked a task and under whom", () => {
    const ledger = sampleLedger();

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

  test("serves lineage through agent:list", () => {
    const run = deployedRun("lineage-cli");
    const lineage = agentListCommand({ run, task: "task-1" });
    expect(String(lineage.markdown)).toContain("### Task Lineage: task-1");
    expect(String(lineage.markdown)).toContain("`impl-1` ← `coordinator-1`");
  });

  test("serves active roster through agent:list", () => {
    const run = deployedRun("roster-cli");
    const roster = agentListCommand({ run });
    expect(roster.active_grants).toBe(5);
    expect(roster.released_grants).toBe(0);
    expect(String(roster.markdown)).toContain("### Deployed Agents");
  });

  test("reflects released grants in agent:list with --all", () => {
    const run = deployedRun("lineage-release");
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

  test("resolves deep 4-level lineage hierarchy from leaf to root", () => {
    const deepLedger: AgentGrantRecord[] = [
      {
        id: "coord-root",
        role: "coordinator",
        parent_agent_id: null,
        parent_task_id: null,
        host: "claude-code",
        granted_at: "2026-08-19T00:00:00.000Z",
        status: "active",
      },
      {
        id: "manager-1",
        role: "implementer",
        parent_agent_id: "coord-root",
        parent_task_id: "task-deep",
        host: "claude-code",
        granted_at: "2026-08-19T00:00:00.000Z",
        status: "active",
      },
      {
        id: "impl-deep",
        role: "implementer",
        parent_agent_id: "manager-1",
        parent_task_id: "task-deep",
        host: "claude-code",
        granted_at: "2026-08-19T00:00:00.000Z",
        status: "active",
      },
      {
        id: "sub-deep",
        role: "sub-investigator",
        parent_agent_id: "impl-deep",
        parent_task_id: "task-deep",
        host: "claude-code",
        granted_at: "2026-08-19T00:00:00.000Z",
        status: "active",
      },
    ] as AgentGrantRecord[];

    const lineage = taskLineage(deepLedger, "task-deep");
    expect(lineage.agents.map((n) => n.agent_id)).toEqual(["manager-1", "impl-deep", "sub-deep"]);
    expect(lineage.agents.map((n) => n.depth)).toEqual([0, 1, 2]);

    const leafNode = lineage.agents.find((n) => n.agent_id === "sub-deep");
    expect(leafNode?.ancestors).toEqual(["impl-deep", "manager-1", "coord-root"]);

    expect(ancestorChain(deepLedger, "sub-deep")).toEqual(["impl-deep", "manager-1", "coord-root"]);
  });
});
