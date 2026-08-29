import { describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  AGENT_LEDGER_KEY,
  assertAgentBudget,
  findGrant,
  knownTaskIds,
  readAgentLedger,
  releaseAllActiveGrants,
  releaseGrantInLedger,
  replaceGrant,
  requireGrant,
  writeAgentLedger,
} from "../../../../olt/scripts/src/workflow/agents/ledger.ts";

function sampleGrant(id: string, status: "active" | "released" = "active"): AgentGrantRecord {
  return {
    id,
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "local",
    granted_at: "2026-08-20T00:00:00.000Z",
    status,
  };
}

describe("workflow/agents/ledger", () => {
  test("readAgentLedger returns empty array when agents key is undefined", () => {
    const state: JsonObject = {};
    expect(readAgentLedger(state)).toEqual([]);
  });

  test("readAgentLedger throws INTEGRITY when agents key is not an array", () => {
    const state: JsonObject = { [AGENT_LEDGER_KEY]: "not-an-array" };
    expect(() => readAgentLedger(state)).toThrow(HarnessError);
    expect(() => readAgentLedger(state)).toThrow(
      "state.agents must be an array of agent grant records",
    );
  });

  test("readAgentLedger throws INTEGRITY when an element is not a valid AgentGrantRecord", () => {
    const state: JsonObject = {
      [AGENT_LEDGER_KEY]: [sampleGrant("agent-1"), { id: "invalid-grant-missing-fields" }],
    };
    expect(() => readAgentLedger(state)).toThrow(HarnessError);
    expect(() => readAgentLedger(state)).toThrow("state.agents[1] is not an agent grant record");
  });

  test("readAgentLedger returns array of records when valid", () => {
    const g1 = sampleGrant("agent-1");
    const g2 = sampleGrant("agent-2", "released");
    const state: JsonObject = { [AGENT_LEDGER_KEY]: [g1, g2] };
    expect(readAgentLedger(state)).toEqual([g1, g2]);
  });

  test("writeAgentLedger writes a copy of ledger to draft", () => {
    const draft: JsonObject = {};
    const ledger = [sampleGrant("agent-1")];
    writeAgentLedger(draft, ledger);
    expect(draft[AGENT_LEDGER_KEY]).toEqual(ledger);
    expect(draft[AGENT_LEDGER_KEY]).not.toBe(ledger);
  });

  test("findGrant returns matching grant or undefined", () => {
    const g1 = sampleGrant("agent-1");
    const g2 = sampleGrant("agent-2");
    const ledger = [g1, g2];
    expect(findGrant(ledger, "agent-1")).toEqual(g1);
    expect(findGrant(ledger, "agent-3")).toBeUndefined();
  });

  test("requireGrant returns matching grant or throws INVALID_STATE", () => {
    const g1 = sampleGrant("agent-1");
    const ledger = [g1];
    expect(requireGrant(ledger, "agent-1")).toEqual(g1);
    expect(() => requireGrant(ledger, "agent-unknown")).toThrow(HarnessError);
    expect(() => requireGrant(ledger, "agent-unknown")).toThrow(
      "agent agent-unknown holds no grant; register it with agent:register first",
    );
  });

  test("replaceGrant replaces matching grant by id and leaves others untouched", () => {
    const g1 = sampleGrant("agent-1");
    const g2 = sampleGrant("agent-2");
    const updatedG1 = { ...g1, status: "released" as const };
    const ledger = [g1, g2];
    const result = replaceGrant(ledger, updatedG1);
    expect(result).toEqual([updatedG1, g2]);
  });

  test("assertAgentBudget passes when within budget and throws when exhausted", () => {
    const ledger = [sampleGrant("agent-1"), sampleGrant("agent-2")];
    expect(() => assertAgentBudget(ledger, 1, 3)).not.toThrow();
    expect(() => assertAgentBudget(ledger, 0, 2)).not.toThrow();
    expect(() => assertAgentBudget(ledger, 2, 3)).toThrow(HarnessError);
    expect(() => assertAgentBudget(ledger, 2, 3)).toThrow(
      "max_agents budget of 3 is exhausted: 2 active grants and this needs 2 more",
    );
  });

  test("knownTaskIds collects task ids from tasks object and branch sub_tasks", () => {
    const state: JsonObject = {
      tasks: {
        "T-1": { id: "T-1" },
        "T-2": { id: "T-2" },
      },
      branches: [
        {
          id: "B-1",
          sub_tasks: [{ id: "T-3" }, { id: "T-4" }, { not_an_id: 123 }, "not-an-object"],
        },
        "not-a-branch-object",
        { id: "B-2", sub_tasks: "not-an-array" },
      ],
    };
    const ids = knownTaskIds(state);
    expect(ids).toEqual(new Set(["T-1", "T-2", "T-3", "T-4"]));

    // Edge cases with empty/missing properties
    expect(knownTaskIds({})).toEqual(new Set());
    expect(knownTaskIds({ tasks: "not-an-object", branches: "not-an-array" })).toEqual(new Set());
  });

  test("releaseGrantInLedger releases matching active grant with reason and timestamp", () => {
    const g1 = sampleGrant("agent-1", "active");
    const g2 = sampleGrant("agent-2", "active");
    const g3 = sampleGrant("agent-3", "released");
    const ledger = [g1, g2, g3];

    const updated = releaseGrantInLedger(
      ledger,
      "agent-1",
      "task done",
      "2026-08-21T00:00:00.000Z",
    );
    expect(updated[0]).toEqual({
      ...g1,
      status: "released",
      released_at: "2026-08-21T00:00:00.000Z",
      release_reason: "task done",
    });
    expect(updated[1]).toEqual(g2);
    expect(updated[2]).toEqual(g3);

    // Default timestamp branch when releasedAt is omitted
    const defaultTimeUpdated = releaseGrantInLedger([g1], "agent-1", "no time given");
    expect(defaultTimeUpdated[0]!.status).toBe("released");
    expect(typeof defaultTimeUpdated[0]!.released_at).toBe("string");

    // When grant is not active or agentId doesn't match
    const unchanged = releaseGrantInLedger([g3], "agent-3", "already released");
    expect(unchanged[0]).toEqual(g3);
  });

  test("releaseAllActiveGrants releases all active grants and leaves released untouched", () => {
    const g1 = sampleGrant("agent-1", "active");
    const g2 = sampleGrant("agent-2", "active");
    const g3 = sampleGrant("agent-3", "released");
    const ledger = [g1, g2, g3];

    const updated = releaseAllActiveGrants(ledger, "batch release", "2026-08-21T12:00:00.000Z");
    expect(updated[0]!.status).toBe("released");
    expect(updated[0]!.release_reason).toBe("batch release");
    expect(updated[0]!.released_at).toBe("2026-08-21T12:00:00.000Z");
    expect(updated[1]!.status).toBe("released");
    expect(updated[2]).toEqual(g3);

    // Default timestamp branch
    const defaultTime = releaseAllActiveGrants([g1], "default timestamp");
    expect(typeof defaultTime[0]!.released_at).toBe("string");
  });
});
