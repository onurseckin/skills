import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/store/index.ts";
import {
  recordAgentReport,
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../olt/scripts/src/workflow/agents/grants.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function freshRun(label: string): string {
  const root = scratchRoot(import.meta.path, label);
  const repo = join(root, "repo");
  mkdirSync(repo);
  return initRun(repo, "grants-run", new TextEncoder().encode("prompt"), "file", true);
}

function seedTask(run: string, taskId: string): void {
  transact(run, "test-setup", "seed-graph", {}, (draft) => {
    draft.graph = { revision: 1, gates: [] };
    draft.requirements = { requirements: [] };
    draft.tasks = { [taskId]: { id: taskId } };
  });
}

const NOW = new Date("2026-08-19T00:00:00.000Z");

describe("registerAgentGrant", () => {
  test("refuses to make an agent its own parent", () => {
    const run = freshRun("self-parent");
    expect(() =>
      registerAgentGrant({
        runRoot: run,
        agentId: "agent-1",
        role: "implementer",
        parentAgentId: "agent-1",
        parentTaskId: null,
        host: "some-host",
        actor: "coordinator",
        maxAgents: 10,
        telemetry: {},
        now: NOW,
      }),
    ).toThrow(/an agent cannot be its own parent/);
  });

  test("refuses to bind a grant to a task that does not exist in this run", () => {
    const run = freshRun("unknown-task");
    seedTask(run, "T-1");
    expect(() =>
      registerAgentGrant({
        runRoot: run,
        agentId: "agent-1",
        role: "implementer",
        parentAgentId: null,
        parentTaskId: "T-ghost",
        host: "some-host",
        actor: "coordinator",
        maxAgents: 10,
        telemetry: {},
        now: NOW,
      }),
    ).toThrow(/parent task T-ghost does not exist in this run/);
  });

  test("refuses to register the same agent id twice", () => {
    const run = freshRun("duplicate-agent");
    const register = (): ReturnType<typeof registerAgentGrant> =>
      registerAgentGrant({
        runRoot: run,
        agentId: "agent-1",
        role: "implementer",
        parentAgentId: null,
        parentTaskId: null,
        host: "some-host",
        actor: "coordinator",
        maxAgents: 10,
        telemetry: {},
        now: NOW,
      });
    register();
    expect(register).toThrow(/agent agent-1 already holds a grant in this run/);
  });
});

describe("recordAgentReport", () => {
  function registered(run: string, agentId = "agent-1"): void {
    registerAgentGrant({
      runRoot: run,
      agentId,
      role: "implementer",
      parentAgentId: null,
      parentTaskId: null,
      host: "some-host",
      actor: "coordinator",
      maxAgents: 10,
      telemetry: {},
      now: NOW,
    });
  }

  test("merges a repeated tool report into the existing entry instead of duplicating it", () => {
    const run = freshRun("merge-repeated-tool");
    registered(run);
    recordAgentReport({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      tools: [{ name: "Bash", category: "test-runner" }],
      tokensEstimated: false,
      now: NOW,
    });
    const outcome = recordAgentReport({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      tools: [{ name: "Bash", extras: { calls: 2 } }],
      tokensEstimated: false,
      now: new Date("2026-08-19T00:05:00.000Z"),
    });
    expect(outcome.grant.tools_used).toHaveLength(1);
    expect(outcome.grant.tools_used?.[0]).toMatchObject({
      name: "Bash",
      category: "test-runner",
      extras: { calls: 2 },
    });
  });

  test("refuses to record a report against a released grant", () => {
    const run = freshRun("report-after-release");
    registered(run);
    releaseAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      reason: "done",
      now: NOW,
    });
    expect(() =>
      recordAgentReport({
        runRoot: run,
        agentId: "agent-1",
        actor: "coordinator",
        tools: [{ name: "Bash" }],
        tokensEstimated: false,
        now: NOW,
      }),
    ).toThrow(/agent agent-1 released its grant and can no longer report/);
  });
});

describe("releaseAgentGrant", () => {
  test("refuses to release an already-released grant", () => {
    const run = freshRun("double-release");
    registerAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: null,
      parentTaskId: null,
      host: "some-host",
      actor: "coordinator",
      maxAgents: 10,
      telemetry: {},
      now: NOW,
    });
    releaseAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      actor: "coordinator",
      reason: "done",
      now: NOW,
    });
    expect(() =>
      releaseAgentGrant({
        runRoot: run,
        agentId: "agent-1",
        actor: "coordinator",
        reason: "again",
        now: NOW,
      }),
    ).toThrow(/agent agent-1 already released its grant at/);
  });
});
