import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import { cleanupVirtualAgentsFS, setupVirtualAgentsFS } from "../fixture.ts";

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

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

describe("executeAgentReset", () => {
  test("releases specific active agents and returns kill directive", () => {
    const ledger: AgentGrantRecord[] = [
      createMockGrant({ id: "agent-1", status: "active" }),
      createMockGrant({ id: "agent-2", status: "active" }),
      createMockGrant({ id: "agent-3", status: "active" }),
    ];
    const { port, getState } = createMockPort({ [AGENT_LEDGER_KEY]: ledger });

    const fixedTime = "2026-08-22T19:00:00.000Z";
    const result = executeAgentReset(port, {
      agentIds: ["agent-1", "agent-3"],
      reason: "targeted_remediation",
      clock: () => fixedTime,
    });

    expect(result.releasedCount).toBe(2);
    expect(result.releasedAgentIds).toEqual(["agent-1", "agent-3"]);
    expect(result.hostDirectives).toEqual({
      action: "kill",
      conversationIds: ["agent-1", "agent-3"],
    });
    expect(result.summary).toContain("Released 2 active agent grant(s)");

    const updatedLedger = readAgentLedger(getState());
    const g1 = updatedLedger.find((g) => g.id === "agent-1");
    const g2 = updatedLedger.find((g) => g.id === "agent-2");
    const g3 = updatedLedger.find((g) => g.id === "agent-3");

    expect(g1?.status).toBe("released");
    expect(g1?.release_reason).toBe("targeted_remediation");
    expect(g1?.released_at).toBe(fixedTime);

    expect(g2?.status).toBe("active");

    expect(g3?.status).toBe("released");
    expect(g3?.release_reason).toBe("targeted_remediation");
    expect(g3?.released_at).toBe(fixedTime);
  });

  test("releases all active agents when allActive is true and returns kill_all directive", () => {
    const ledger: AgentGrantRecord[] = [
      createMockGrant({ id: "agent-1", status: "active" }),
      createMockGrant({ id: "agent-2", status: "released", release_reason: "prior_done" }),
      createMockGrant({ id: "agent-3", status: "active" }),
    ];
    const { port, getState } = createMockPort({ [AGENT_LEDGER_KEY]: ledger });

    const fixedTime = "2026-08-22T20:00:00.000Z";
    const result = executeAgentReset(port, {
      allActive: true,
      clock: () => fixedTime,
    });

    expect(result.releasedCount).toBe(2);
    expect(result.releasedAgentIds).toEqual(["agent-1", "agent-3"]);
    expect(result.hostDirectives).toEqual({
      action: "kill_all",
    });
    expect(result.summary).toContain("Released 2 active agent grant(s)");

    const updatedLedger = readAgentLedger(getState());
    const g1 = updatedLedger.find((g) => g.id === "agent-1");
    const g2 = updatedLedger.find((g) => g.id === "agent-2");
    const g3 = updatedLedger.find((g) => g.id === "agent-3");

    expect(g1?.status).toBe("released");
    expect(g1?.release_reason).toBe("hard_agent_reset");
    expect(g1?.released_at).toBe(fixedTime);

    expect(g2?.status).toBe("released");
    expect(g2?.release_reason).toBe("prior_done");

    expect(g3?.status).toBe("released");
    expect(g3?.release_reason).toBe("hard_agent_reset");
    expect(g3?.released_at).toBe(fixedTime);
  });

  test("handles already-released and unknown agent IDs gracefully", () => {
    const ledger: AgentGrantRecord[] = [
      createMockGrant({ id: "agent-1", status: "released", release_reason: "already_closed" }),
      createMockGrant({ id: "agent-2", status: "active" }),
    ];
    const { port, getState } = createMockPort({ [AGENT_LEDGER_KEY]: ledger });

    const result = executeAgentReset(port, {
      agentIds: ["agent-1", "agent-unknown"],
    });

    expect(result.releasedCount).toBe(0);
    expect(result.releasedAgentIds).toEqual([]);
    expect(result.hostDirectives).toEqual({
      action: "kill",
      conversationIds: [],
    });
    expect(result.summary).toBe("No active agent grants were released.");

    const updatedLedger = readAgentLedger(getState());
    const g1 = updatedLedger.find((g) => g.id === "agent-1");
    const g2 = updatedLedger.find((g) => g.id === "agent-2");

    expect(g1?.release_reason).toBe("already_closed");
    expect(g2?.status).toBe("active");
  });

  test("defaults to hard_agent_reset reason and system clock when options omitted", () => {
    const ledger: AgentGrantRecord[] = [createMockGrant({ id: "agent-1", status: "active" })];
    const { port, getState } = createMockPort({ [AGENT_LEDGER_KEY]: ledger });

    const result = executeAgentReset(port, {
      allActive: true,
    });

    expect(result.releasedCount).toBe(1);
    const updatedLedger = readAgentLedger(getState());
    expect(updatedLedger[0]?.release_reason).toBe("hard_agent_reset");
    expect(typeof updatedLedger[0]?.released_at).toBe("string");
  });

  test("handles empty state and options smoothly", () => {
    const { port, getState } = createMockPort({});
    const result = executeAgentReset(port);

    expect(result.releasedCount).toBe(0);
    expect(result.releasedAgentIds).toEqual([]);
    expect(result.hostDirectives).toEqual({
      action: "kill",
      conversationIds: [],
    });
    expect(readAgentLedger(getState())).toEqual([]);
  });
});

describe("formatAgentResetBrief", () => {
  test("formats brief for targeted reset result", () => {
    const result: AgentResetResult = {
      releasedAgentIds: ["agent-1", "agent-2"],
      releasedCount: 2,
      hostDirectives: {
        action: "kill",
        conversationIds: ["agent-1", "agent-2"],
      },
      summary: "Released 2 active agent grant(s): agent-1, agent-2.",
    };

    const brief = formatAgentResetBrief(result);
    expect(brief).toContain("# Hard Agent Reset Brief");
    expect(brief).toContain("- **Released Count**: 2");
    expect(brief).toContain("- **Directive Action**: `kill`");
    expect(brief).toContain("- **Released Agents**: `agent-1`, `agent-2`");
    expect(brief).toContain("- **Conversation IDs**: `agent-1`, `agent-2`");
    expect(brief).toContain("- **Summary**: Released 2 active agent grant(s): agent-1, agent-2.");
  });

  test("formats brief for kill_all reset without conversationIds", () => {
    const result: AgentResetResult = {
      releasedAgentIds: ["agent-alpha"],
      releasedCount: 1,
      hostDirectives: {
        action: "kill_all",
      },
      summary: "Released 1 active agent grant(s): agent-alpha.",
    };

    const brief = formatAgentResetBrief(result);
    expect(brief).toContain("# Hard Agent Reset Brief");
    expect(brief).toContain("- **Released Count**: 1");
    expect(brief).toContain("- **Directive Action**: `kill_all`");
    expect(brief).toContain("- **Released Agents**: `agent-alpha`");
    expect(brief).not.toContain("- **Conversation IDs**");
  });

  test("formats brief for zero-released reset cleanly", () => {
    const result: AgentResetResult = {
      releasedAgentIds: [],
      releasedCount: 0,
      hostDirectives: {
        action: "kill",
        conversationIds: [],
      },
      summary: "No active agent grants were released.",
    };

    const brief = formatAgentResetBrief(result);
    expect(brief).toContain("# Hard Agent Reset Brief");
    expect(brief).toContain("- **Released Count**: 0");
    expect(brief).toContain("- **Released Agents**: _None_");
    expect(brief).toContain("- **Conversation IDs**: _None_");
    expect(brief).toContain("- **Summary**: No active agent grants were released.");
  });
});
