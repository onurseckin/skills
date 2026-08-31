import { describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  AGENT_LEDGER_KEY,
  readAgentLedger,
  releaseAllActiveGrants,
  releaseGrantInLedger,
  writeAgentLedger,
} from "../../../olt/scripts/src/workflow/agents/ledger.ts";
import {
  executeAgentReset,
  formatAgentResetBrief,
  type AgentResetOptions,
  type AgentResetResult,
  type WorkflowPort,
} from "../../../olt/scripts/src/workflow/agents/reset.ts";

function createMockGrant(overrides: Partial<AgentGrantRecord> = {}): AgentGrantRecord {
  const base: AgentGrantRecord = {
    id: "agent-1",
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "test-host",
    granted_at: "2026-08-20T00:00:00.000Z",
    status: "active",
  };
  return {
    ...base,
    ...overrides,
  };
}

function createMockPort(initialState: JsonObject = {}): {
  port: WorkflowPort;
  getState: () => JsonObject;
  getWrites: () => JsonObject[];
} {
  let state = structuredClone(initialState);
  const writes: JsonObject[] = [];

  const port: WorkflowPort = {
    read: (): JsonObject => state,
    write: (draft: JsonObject): void => {
      state = structuredClone(draft);
      writes.push(state);
    },
  };

  return {
    port,
    getState: () => state,
    getWrites: () => writes,
  };
}


describe("releaseGrantInLedger", () => {
  test("releases an active grant with specified reason and timestamp", () => {
    const ledger: AgentGrantRecord[] = [
      createMockGrant({ id: "agent-1", status: "active" }),
      createMockGrant({ id: "agent-2", status: "active" }),
    ];
    const releasedAt = "2026-08-22T12:00:00.000Z";
    const updated = releaseGrantInLedger(ledger, "agent-1", "manual_reset", releasedAt);

    expect(updated).toHaveLength(2);
    const agent1 = updated.find((g) => g.id === "agent-1");
    const agent2 = updated.find((g) => g.id === "agent-2");

    expect(agent1?.status).toBe("released");
    expect(agent1?.release_reason).toBe("manual_reset");
    expect(agent1?.released_at).toBe(releasedAt);

    expect(agent2?.status).toBe("active");
    expect(agent2?.release_reason).toBeUndefined();
    expect(agent2?.released_at).toBeUndefined();
  });

  test("uses fallback timestamp when releasedAt is undefined", () => {
    const ledger: AgentGrantRecord[] = [createMockGrant({ id: "agent-1", status: "active" })];
    const updated = releaseGrantInLedger(ledger, "agent-1", "timeout");

    expect(updated[0]?.status).toBe("released");
    expect(updated[0]?.release_reason).toBe("timeout");
    expect(typeof updated[0]?.released_at).toBe("string");
    expect(updated[0]?.released_at?.length).toBeGreaterThan(0);
  });

  test("gracefully ignores already-released grants and preserves their original metadata", () => {
    const initialReleasedAt = "2026-08-20T05:00:00.000Z";
    const initialReason = "normal_completion";
    const ledger: AgentGrantRecord[] = [
      createMockGrant({
        id: "agent-1",
        status: "released",
        released_at: initialReleasedAt,
        release_reason: initialReason,
      }),
    ];

    const updated = releaseGrantInLedger(
      ledger,
      "agent-1",
      "hard_reset",
      "2026-08-22T15:00:00.000Z",
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]?.status).toBe("released");
    expect(updated[0]?.release_reason).toBe(initialReason);
    expect(updated[0]?.released_at).toBe(initialReleasedAt);
  });

  test("gracefully returns ledger unchanged if agentId is not found", () => {
    const ledger: AgentGrantRecord[] = [createMockGrant({ id: "agent-1", status: "active" })];
    const updated = releaseGrantInLedger(ledger, "agent-non-existent", "test");

    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe("agent-1");
    expect(updated[0]?.status).toBe("active");
  });
});

describe("releaseAllActiveGrants", () => {
  test("releases all active grants while preserving already-released grants", () => {
    const initialReleasedAt = "2026-08-19T00:00:00.000Z";
    const initialReason = "task_done";
    const ledger: AgentGrantRecord[] = [
      createMockGrant({ id: "agent-1", status: "active" }),
      createMockGrant({
        id: "agent-2",
        status: "released",
        released_at: initialReleasedAt,
        release_reason: initialReason,
      }),
      createMockGrant({ id: "agent-3", status: "active" }),
    ];
    const releasedAt = "2026-08-22T18:00:00.000Z";
    const updated = releaseAllActiveGrants(ledger, "hard_agent_reset", releasedAt);

    expect(updated).toHaveLength(3);

    const agent1 = updated.find((g) => g.id === "agent-1");
    const agent2 = updated.find((g) => g.id === "agent-2");
    const agent3 = updated.find((g) => g.id === "agent-3");

    expect(agent1?.status).toBe("released");
    expect(agent1?.release_reason).toBe("hard_agent_reset");
    expect(agent1?.released_at).toBe(releasedAt);

    expect(agent2?.status).toBe("released");
    expect(agent2?.release_reason).toBe(initialReason);
    expect(agent2?.released_at).toBe(initialReleasedAt);

    expect(agent3?.status).toBe("released");
    expect(agent3?.release_reason).toBe("hard_agent_reset");
    expect(agent3?.released_at).toBe(releasedAt);
  });

  test("handles empty ledger cleanly", () => {
    const updated = releaseAllActiveGrants([], "hard_agent_reset");
    expect(updated).toEqual([]);
  });

  test("uses fallback ISO timestamp when releasedAt is undefined", () => {
    const ledger: AgentGrantRecord[] = [createMockGrant({ id: "agent-1", status: "active" })];
    const updated = releaseAllActiveGrants(ledger, "reset");
    expect(updated[0]?.status).toBe("released");
    expect(typeof updated[0]?.released_at).toBe("string");
  });
});

