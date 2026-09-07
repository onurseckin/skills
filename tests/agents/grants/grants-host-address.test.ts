import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { isAgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { registerAgentGrant } from "../../../olt/scripts/src/workflow/agents/grants.ts";
import { readAgentLedger } from "../../../olt/scripts/src/workflow/agents/ledger.ts";
import {
  cleanupVirtualAgentsFS,
  getVirtualAgentsFS,
  scratchRoot,
  setupVirtualAgentsFS,
} from "../fixture.ts";

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

function freshRun(label: string): string {
  const root = scratchRoot("agent-grants-host-test", label);
  const repo = join(root, "repo");
  const vfs = getVirtualAgentsFS();
  vfs.mkdirSync(repo, { recursive: true });
  return initRun(repo, "grants-host-run", new TextEncoder().encode("prompt"), "file", true);
}

const NOW = new Date("2026-08-19T00:00:00.000Z");

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
