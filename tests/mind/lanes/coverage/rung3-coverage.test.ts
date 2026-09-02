import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import * as ledgerModule from "../../../../olt/scripts/src/workflow/agents/ledger.ts";
import * as grantsModule from "../../../../olt/scripts/src/workflow/agents/grants.ts";
import { executeRung3 } from "../../../../olt/scripts/src/mind/lanes/rescue/rungs/rung3.ts";
import type { Clock } from "../../../../olt/scripts/src/workflow/types.ts";
import type { AgentGrantRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";

describe("Rung 3 Rescue Lane Coverage Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const clock: Clock = { now: () => new Date("2026-09-01T12:00:00.000Z") };
  const nowMs = 1788264000000; // 2026-09-01T12:00:00.000Z

  const mkGrant = (
    id: string,
    role: string,
    status: AgentGrantRecord["status"],
    grantedAt: string,
  ): AgentGrantRecord => ({
    id,
    role,
    status,
    scope: { allowed_directories: ["."] },
    capabilities: [],
    granted_at: grantedAt,
    last_heartbeat: grantedAt,
  });

  const mockRun = (
    state: Record<string, unknown>,
    events: Array<{ actor: string; timestamp: string; payload?: unknown }> = [],
  ) => ({ state, events }) as unknown as ReturnType<typeof storeModule.loadRun>;

  it("returns empty result when runs have no active agent grants", () => {
    spies.push(spyOn(storeModule, "loadRun").mockReturnValue(mockRun({})));
    spies.push(spyOn(ledgerModule, "readAgentLedger").mockReturnValue([]));

    const actionsTaken: string[] = [];
    const result = executeRung3({
      liveRunRoots: ["/runs/live-1"],
      mindRunRoot: "/runs/mind-root",
      actor: "rescuer",
      nowMs,
      grantIdleSeconds: 300,
      clock,
      actionsTaken,
    });

    expect(result.deadAgentsReleased).toEqual([]);
    expect(actionsTaken).toEqual([]);
  });

  it("does not release agents that have recent activity across various event patterns", () => {
    const recentIso = "2026-09-01T11:58:00.000Z"; // 120s ago < 300s
    const oldIso = "2026-09-01T11:00:00.000Z"; // 3600s ago

    const grants = [
      mkGrant("ag-actor", "worker", "active", oldIso),
      mkGrant("ag-payload", "worker", "active", oldIso),
      mkGrant("ag-val", "validator", "active", oldIso),
      mkGrant("ag-critic", "critic", "active", oldIso),
      mkGrant("ag-inactive", "worker", "released", oldIso),
    ];

    const events = [
      { actor: "ag-actor", timestamp: recentIso },
      { actor: "other", timestamp: recentIso, payload: { agent_id: "ag-payload" } },
      { actor: "other", timestamp: recentIso, payload: { validator_id: "ag-val" } },
      { actor: "other", timestamp: recentIso, payload: { critic_id: "ag-critic" } },
      { actor: "other", timestamp: "invalid-date", payload: null },
    ];

    spies.push(spyOn(storeModule, "loadRun").mockReturnValue(mockRun({}, events)));
    spies.push(spyOn(ledgerModule, "readAgentLedger").mockReturnValue(grants));

    const actionsTaken: string[] = [];
    const result = executeRung3({
      liveRunRoots: ["/runs/live-active"],
      mindRunRoot: "/runs/mind-root",
      actor: "rescuer",
      nowMs,
      grantIdleSeconds: 300,
      clock,
      actionsTaken,
    });

    expect(result.deadAgentsReleased).toEqual([]);
    expect(actionsTaken).toEqual([]);
  });

  it("releases idle agents, mutates draft agents array, and calls releaseAgentGrant", () => {
    const oldIso = "2026-09-01T10:00:00.000Z"; // 7200s ago > 300s
    const grants = [mkGrant("ag-dead-1", "architect", "active", oldIso)];

    let transactedDraft: Record<string, unknown> | null = null;
    spies.push(
      spyOn(storeModule, "transact").mockImplementation((_p, _a, _k, _pl, mutate) => {
        const draft: Record<string, unknown> = {
          agents: [
            { id: "ag-dead-1", role: "architect", status: "active" },
            { id: "ag-other", role: "worker", status: "active" },
          ],
        };
        if (typeof mutate === "function") mutate(draft as never);
        transactedDraft = draft;
        return draft as never;
      }),
    );

    let releasedGrantPayload: unknown = null;
    spies.push(
      spyOn(grantsModule, "releaseAgentGrant").mockImplementation((params) => {
        releasedGrantPayload = params;
      }),
    );

    spies.push(
      spyOn(storeModule, "loadRun").mockReturnValue(
        mockRun({}, [
          { actor: "ag-dead-1", timestamp: "not-a-date" }, // invalid timestamp fallback to granted_at
        ]),
      ),
    );
    spies.push(spyOn(ledgerModule, "readAgentLedger").mockReturnValue(grants));

    const actionsTaken: string[] = [];
    const result = executeRung3({
      liveRunRoots: ["/runs/live-idle"],
      mindRunRoot: "/runs/mind-root",
      actor: "rescuer",
      nowMs,
      grantIdleSeconds: 300,
      clock,
      actionsTaken,
    });

    expect(result.deadAgentsReleased).toHaveLength(2); // live-idle and mind-root
    expect(result.deadAgentsReleased[0].agentId).toBe("ag-dead-1");
    expect(result.deadAgentsReleased[0].role).toBe("architect");
    expect(result.deadAgentsReleased[0].idleSeconds).toBeGreaterThan(300);
    expect(actionsTaken).toHaveLength(2);
    expect(actionsTaken[0]).toContain("Rung 3: released presumed dead agent ag-dead-1");

    expect(releasedGrantPayload).toEqual({
      runRoot: "/runs/mind-root",
      agentId: "ag-dead-1",
      actor: "rescuer",
      reason: "presumed_dead",
    });

    expect(transactedDraft).not.toBeNull();
    const workingAgents = (
      transactedDraft as { agents: Array<{ id: string; status: string; release_reason: string }> }
    ).agents;
    expect(workingAgents[0].status).toBe("released");
    expect(workingAgents[0].release_reason).toBe("presumed_dead");
  });

  it("handles edge cases: future timestamp, missing agents in draft, failing releaseAgentGrant, and corrupt runs", () => {
    // 1. Future timestamp -> idleSeconds = 0
    const futureIso = "2026-09-01T13:00:00.000Z";
    const oldIso = "2026-09-01T10:00:00.000Z";

    let transactCalls = 0;
    spies.push(
      spyOn(storeModule, "transact").mockImplementation((_p, _a, _k, _pl, mutate) => {
        transactCalls++;
        const draft: Record<string, unknown> = { agents: "not-an-array" }; // non-array agents
        if (typeof mutate === "function") mutate(draft as never);
        return draft as never;
      }),
    );

    // Failing releaseAgentGrant
    spies.push(
      spyOn(grantsModule, "releaseAgentGrant").mockImplementation(() => {
        throw new Error("Release grant failed");
      }),
    );

    spies.push(
      spyOn(storeModule, "loadRun").mockImplementation((runPath: string) => {
        if (runPath.includes("corrupted")) throw new Error("Disk error");
        return mockRun({});
      }),
    );

    spies.push(
      spyOn(ledgerModule, "readAgentLedger").mockImplementation((_state) => [
        mkGrant("ag-future", "worker", "active", futureIso),
        mkGrant("ag-dead-no-match", "scout", "active", oldIso),
      ]),
    );

    const actionsTaken: string[] = [];
    const result = executeRung3({
      liveRunRoots: ["/runs/corrupted", "/runs/live-edge"],
      mindRunRoot: "/runs/mind-edge",
      actor: "rescuer",
      nowMs,
      grantIdleSeconds: 300,
      clock,
      actionsTaken,
    });

    // 2 runs succeeded (live-edge, mind-edge), corrupted was skipped
    expect(result.deadAgentsReleased).toHaveLength(2);
    expect(transactCalls).toBe(2);
    expect(actionsTaken).toHaveLength(2);
  });
});
