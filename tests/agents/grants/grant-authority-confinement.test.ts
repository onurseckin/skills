import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  registerAgentGrant,
  recordAgentReport,
  releaseAgentGrant,
} from "../../../olt/scripts/src/workflow/agents/grants.ts";
import { cleanupVirtualAgentsFS, setupVirtualAgentsFS } from "../fixture.ts";
import { cleanupGrantRoots, seededRun } from "./agent-grant-fixtures.ts";

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

afterAll(() => {
  cleanupGrantRoots();
});

describe("Agent Grant Authority & Confinement Constraints", () => {
  test("conditional_genesis is rejected when ledger is not empty or parent is specified", () => {
    const run = seededRun(import.meta.path, "genesis-checks");
    registerAgentGrant({
      runRoot: run,
      agentId: "orchestrator-1",
      role: "orchestrator",
      parentAgentId: null,
      parentTaskId: "task-1",
      host: "claude-code",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });

    // Attempting conditional_genesis on non-empty ledger
    expect(() =>
      registerAgentGrant({
        runRoot: run,
        agentId: "orchestrator-2",
        role: "orchestrator",
        parentAgentId: null,
        parentTaskId: "task-1",
        host: "claude-code",
        authority: { kind: "conditional_genesis" },
        maxAgents: 10,
        telemetry: {},
      }),
    ).toThrow(/conditional agent genesis is valid only for the first grant/i);

    // Attempting conditional_genesis with non-null parent
    const emptyRun = seededRun(import.meta.path, "genesis-with-parent");
    expect(() =>
      registerAgentGrant({
        runRoot: emptyRun,
        agentId: "coordinator-1",
        role: "coordinator",
        parentAgentId: "orchestrator-1",
        parentTaskId: "task-1",
        host: "claude-code",
        authority: { kind: "conditional_genesis" },
        maxAgents: 10,
        telemetry: {},
      }),
    ).toThrow(/conditional agent genesis is valid only for the first grant/i);
  });

  test("verified_parent requires non-empty ledger, named parent, and matching actor", () => {
    const emptyRun = seededRun(import.meta.path, "verified-empty");
    expect(() =>
      registerAgentGrant({
        runRoot: emptyRun,
        agentId: "coordinator-1",
        role: "coordinator",
        parentAgentId: null,
        parentTaskId: "task-1",
        host: "claude-code",
        authority: { kind: "verified_parent", actorId: "orchestrator-1" },
        maxAgents: 10,
        telemetry: {},
      }),
    ).toThrow(/requires a nonempty ledger and a named parent agent/i);

    const run = seededRun(import.meta.path, "verified-checks");
    registerAgentGrant({
      runRoot: run,
      agentId: "orchestrator-1",
      role: "orchestrator",
      parentAgentId: null,
      parentTaskId: "task-1",
      host: "claude-code",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });

    // Actor does not match parentAgentId
    expect(() =>
      registerAgentGrant({
        runRoot: run,
        agentId: "coordinator-1",
        role: "coordinator",
        parentAgentId: "orchestrator-1",
        parentTaskId: "task-1",
        host: "claude-code",
        authority: { kind: "verified_parent", actorId: "impostor-agent" },
        maxAgents: 10,
        telemetry: {},
      }),
    ).toThrow(/does not match parent agent/i);
  });

  test("parent grant must be active to spawn, and Tier > 1 requires supervising parent", () => {
    const run = seededRun(import.meta.path, "parent-status-and-tier");
    registerAgentGrant({
      runRoot: run,
      agentId: "orchestrator-1",
      role: "orchestrator",
      parentAgentId: null,
      parentTaskId: "task-1",
      host: "claude-code",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });

    releaseAgentGrant({
      runRoot: run,
      actor: "orchestrator-1",
      agentId: "orchestrator-1",
      reason: "completed",
    });

    // Released parent cannot spawn
    expect(() =>
      registerAgentGrant({
        runRoot: run,
        agentId: "coordinator-1",
        role: "coordinator",
        parentAgentId: "orchestrator-1",
        parentTaskId: "task-1",
        host: "claude-code",
        authority: { kind: "verified_parent", actorId: "orchestrator-1" },
        maxAgents: 10,
        telemetry: {},
      }),
    ).toThrow(/holds a released grant, not an active one/i);
  });

  test("recordAgentReport enforces actor authentication and releaseAgentGrant validates actor authorization", () => {
    const run = seededRun(import.meta.path, "actor-report-and-release");
    registerAgentGrant({
      runRoot: run,
      agentId: "orchestrator-1",
      role: "orchestrator",
      parentAgentId: null,
      parentTaskId: "task-1",
      host: "claude-code",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });

    registerAgentGrant({
      runRoot: run,
      agentId: "coordinator-1",
      role: "coordinator",
      parentAgentId: "orchestrator-1",
      parentTaskId: "task-1",
      host: "claude-code",
      authority: { kind: "verified_parent", actorId: "orchestrator-1" },
      maxAgents: 10,
      telemetry: {},
    });

    // Report by non-matching actor
    expect(() =>
      recordAgentReport({
        runRoot: run,
        actor: "other-agent",
        agentId: "coordinator-1",
        tools: [{ name: "Bash", calls: 1, failures: 0 }],
      }),
    ).toThrow(/does not match authenticated actor/i);

    // Release by unauthorized actor (neither self nor active direct parent)
    expect(() =>
      releaseAgentGrant({
        runRoot: run,
        actor: "coordinator-1",
        agentId: "orchestrator-1",
        reason: "failed",
      }),
    ).toThrow(/is not authenticated actor 'coordinator-1' or its active direct child/i);

    expect(() =>
      registerAgentGrant({
        runRoot: run,
        agentId: "worker-1",
        role: "implementer",
        parentAgentId: "coordinator-1",
        parentTaskId: "task-1",
        host: "claude-code",
        authority: { kind: "custom_invalid" as unknown as "conditional_genesis" },
        maxAgents: 10,
        telemetry: {},
      }),
    ).toThrow(/registration authority is invalid/i);
  });
});
