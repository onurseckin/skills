import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isAgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  recordAgentReport,
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../olt/scripts/src/workflow/agents/grants.ts";
import { readAgentLedger } from "../../../olt/scripts/src/workflow/agents/ledger.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

function freshRun(label: string): string {
  const root = mkdtempSync(join(tmpdir(), "agent-grants-test-"));
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
        authority: { kind: "verified_parent", actorId: "agent-1" },
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
        authority: { kind: "conditional_genesis" },
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
        authority: { kind: "conditional_genesis" },
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
      authority: { kind: "conditional_genesis" },
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
      actor: "agent-1",
      tools: [{ name: "Bash", category: "test-runner" }],
      tokensEstimated: false,
      now: NOW,
    });
    const outcome = recordAgentReport({
      runRoot: run,
      agentId: "agent-1",
      actor: "agent-1",
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
      actor: "agent-1",
      reason: "done",
      now: NOW,
    });
    expect(() =>
      recordAgentReport({
        runRoot: run,
        agentId: "agent-1",
        actor: "agent-1",
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
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
      now: NOW,
    });
    releaseAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      actor: "agent-1",
      reason: "done",
      now: NOW,
    });
    expect(() =>
      releaseAgentGrant({
        runRoot: run,
        agentId: "agent-1",
        actor: "agent-1",
        reason: "again",
        now: NOW,
      }),
    ).toThrow(/agent agent-1 already released its grant at/);
  });
});

describe("host_address", () => {
  test("persists the host-routable address across a state write and a fresh load", () => {
    const run = freshRun("host-address-round-trip");
    const outcome = registerAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: null,
      parentTaskId: null,
      host: "claude-code",
      hostAddress: "a35c207176e4bb129",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
      now: NOW,
    });
    expect(outcome.grant.host_address).toBe("a35c207176e4bb129");

    const reloaded = readAgentLedger(loadRun(run).state);
    expect(reloaded.find((grant) => grant.id === "agent-1")?.host_address).toBe(
      "a35c207176e4bb129",
    );
  });

  test("leaves host_address absent when the dispatcher supplies none", () => {
    const run = freshRun("host-address-absent");
    const outcome = registerAgentGrant({
      runRoot: run,
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: null,
      parentTaskId: null,
      host: "claude-code",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
      now: NOW,
    });
    expect(outcome.grant.host_address).toBeUndefined();
    expect(readAgentLedger(loadRun(run).state)[0]).not.toHaveProperty("host_address");
  });

  test("accepts a grant record that carries no host_address", () => {
    const grant = {
      id: "agent-1",
      role: "implementer",
      parent_agent_id: null,
      parent_task_id: null,
      host: "claude-code",
      granted_at: NOW.toISOString(),
      status: "active",
    };
    expect(isAgentGrantRecord(grant)).toBe(true);
    expect(isAgentGrantRecord({ ...grant, host_address: "a35c207176e4bb129" })).toBe(true);
  });

  test("rejects a grant record whose host_address is not a usable address", () => {
    const grant = {
      id: "agent-1",
      role: "implementer",
      parent_agent_id: null,
      parent_task_id: null,
      host: "claude-code",
      granted_at: NOW.toISOString(),
      status: "active",
    };
    expect(isAgentGrantRecord({ ...grant, host_address: "   " })).toBe(false);
    expect(isAgentGrantRecord({ ...grant, host_address: 42 })).toBe(false);
  });
});
