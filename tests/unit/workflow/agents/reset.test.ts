import { describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { AGENT_LEDGER_KEY } from "../../../../olt/scripts/src/workflow/agents/ledger.ts";
import {
  executeAgentReset,
  formatAgentResetBrief,
  type WorkflowPort,
} from "../../../../olt/scripts/src/workflow/agents/reset.ts";

class MemoryWorkflowPort implements WorkflowPort {
  constructor(public state: JsonObject) {}
  read(): JsonObject {
    return this.state;
  }
  write(draft: JsonObject): void {
    this.state = draft;
  }
}

function activeGrant(id: string): AgentGrantRecord {
  return {
    id,
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "local",
    granted_at: "2026-08-20T00:00:00.000Z",
    status: "active",
  };
}

describe("workflow/agents/reset", () => {
  test("executeAgentReset with allActive = true releases all active agents", () => {
    const state: JsonObject = {
      [AGENT_LEDGER_KEY]: [
        activeGrant("agent-1"),
        activeGrant("agent-2"),
        { ...activeGrant("agent-3"), status: "released" as const },
      ],
    };
    const port = new MemoryWorkflowPort(state);
    const result = executeAgentReset(port, {
      allActive: true,
      reason: "kill switch activated",
      clock: () => "2026-08-21T00:00:00.000Z",
    });

    expect(result.releasedCount).toBe(2);
    expect(result.releasedAgentIds).toEqual(["agent-1", "agent-2"]);
    expect(result.hostDirectives).toEqual({ action: "kill_all" });
    expect(result.summary).toBe("Released 2 active agent grant(s): agent-1, agent-2.");

    const updatedLedger = port.read()[AGENT_LEDGER_KEY] as AgentGrantRecord[];
    expect(updatedLedger[0]!.status).toBe("released");
    expect(updatedLedger[0]!.release_reason).toBe("kill switch activated");
    expect(updatedLedger[0]!.released_at).toBe("2026-08-21T00:00:00.000Z");
    expect(updatedLedger[1]!.status).toBe("released");
    expect(updatedLedger[2]!.status).toBe("released");
  });

  test("executeAgentReset with specific agentIds releases only targeted active agents", () => {
    const state: JsonObject = {
      [AGENT_LEDGER_KEY]: [activeGrant("agent-1"), activeGrant("agent-2"), activeGrant("agent-3")],
    };
    const port = new MemoryWorkflowPort(state);
    const result = executeAgentReset(port, {
      agentIds: ["agent-1", "agent-3", "agent-unknown"],
    });

    expect(result.releasedCount).toBe(2);
    expect(result.releasedAgentIds).toEqual(["agent-1", "agent-3"]);
    expect(result.hostDirectives).toEqual({
      action: "kill",
      conversationIds: ["agent-1", "agent-3"],
    });

    const updatedLedger = port.read()[AGENT_LEDGER_KEY] as AgentGrantRecord[];
    expect(updatedLedger[0]!.status).toBe("released");
    expect(updatedLedger[0]!.release_reason).toBe("hard_agent_reset");
    expect(updatedLedger[1]!.status).toBe("active");
    expect(updatedLedger[2]!.status).toBe("released");
  });

  test("executeAgentReset with no active agents matching releases 0 agents", () => {
    const state: JsonObject = {
      [AGENT_LEDGER_KEY]: [{ ...activeGrant("agent-1"), status: "released" as const }],
    };
    const port = new MemoryWorkflowPort(state);
    const result = executeAgentReset(port, { agentIds: ["agent-1"] });

    expect(result.releasedCount).toBe(0);
    expect(result.releasedAgentIds).toEqual([]);
    expect(result.summary).toBe("No active agent grants were released.");
  });

  test("executeAgentReset handles default options (undefined options, empty reason, default clock)", () => {
    const state: JsonObject = {
      [AGENT_LEDGER_KEY]: [activeGrant("agent-1")],
    };
    const port = new MemoryWorkflowPort(state);
    const result = executeAgentReset(port);

    expect(result.releasedCount).toBe(0);
    expect(result.releasedAgentIds).toEqual([]);
    expect(result.hostDirectives).toEqual({ action: "kill", conversationIds: [] });
  });

  test("formatAgentResetBrief formats markdown output accurately for both populated and empty results", () => {
    const populated = formatAgentResetBrief({
      releasedAgentIds: ["agent-1", "agent-2"],
      releasedCount: 2,
      hostDirectives: {
        action: "kill",
        conversationIds: ["c-1", "c-2"],
      },
      summary: "Released 2 active agent grant(s): agent-1, agent-2.",
    });

    expect(populated).toContain("- **Released Count**: 2");
    expect(populated).toContain("- **Directive Action**: `kill`");
    expect(populated).toContain("- **Released Agents**: `agent-1`, `agent-2`");
    expect(populated).toContain("- **Conversation IDs**: `c-1`, `c-2`");
    expect(populated).toContain(
      "- **Summary**: Released 2 active agent grant(s): agent-1, agent-2.",
    );

    const empty = formatAgentResetBrief({
      releasedAgentIds: [],
      releasedCount: 0,
      hostDirectives: {
        action: "kill_all",
      },
      summary: "No active agent grants were released.",
    });

    expect(empty).toContain("- **Released Count**: 0");
    expect(empty).toContain("- **Directive Action**: `kill_all`");
    expect(empty).toContain("- **Released Agents**: _None_");
    expect(empty).not.toContain("- **Conversation IDs**");

    const emptyConversations = formatAgentResetBrief({
      releasedAgentIds: [],
      releasedCount: 0,
      hostDirectives: {
        action: "kill",
        conversationIds: [],
      },
      summary: "No active agent grants were released.",
    });
    expect(emptyConversations).toContain("- **Conversation IDs**: _None_");
  });
});
