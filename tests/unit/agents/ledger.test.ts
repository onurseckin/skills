import { describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../olt/scripts/src/contracts/agents.ts";
import type { JsonObject } from "../../../olt/scripts/src/contracts/json.ts";
import {
  AGENT_LEDGER_KEY,
  assertAgentBudget,
  findGrant,
  knownTaskIds,
  readAgentLedger,
  replaceGrant,
  requireGrant,
  writeAgentLedger,
} from "../../../olt/scripts/src/workflow/agents/ledger.ts";

function grant(overrides: Partial<AgentGrantRecord> = {}): AgentGrantRecord {
  return {
    id: "agent-1",
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "some-host",
    granted_at: "2026-08-19T00:00:00.000Z",
    status: "active",
    ...overrides,
  } as AgentGrantRecord;
}

describe("readAgentLedger / writeAgentLedger", () => {
  test("an absent ledger reads as empty, and a written ledger reads back the same shape", () => {
    expect(readAgentLedger({})).toEqual([]);
    const draft: JsonObject = {};
    writeAgentLedger(draft, [grant()]);
    expect(draft[AGENT_LEDGER_KEY]).toEqual([grant()]);
    expect(readAgentLedger(draft)).toEqual([grant()]);
  });

  test("refuses a non-array ledger and a malformed grant entry", () => {
    expect(() => readAgentLedger({ [AGENT_LEDGER_KEY]: "not-an-array" })).toThrow(
      /state\.agents must be an array/,
    );
    expect(() => readAgentLedger({ [AGENT_LEDGER_KEY]: [{ id: "agent-1" }] })).toThrow(
      /state\.agents\[0\] is not an agent grant record/,
    );
  });
});

describe("findGrant / requireGrant", () => {
  test("finds a grant by id and returns undefined for a stranger", () => {
    const ledger = [grant({ id: "agent-1" }), grant({ id: "agent-2" })];
    expect(findGrant(ledger, "agent-2")?.id).toBe("agent-2");
    expect(findGrant(ledger, "agent-3")).toBeUndefined();
  });

  test("requireGrant returns the grant when present and refuses when absent", () => {
    const ledger = [grant({ id: "agent-1" })];
    expect(requireGrant(ledger, "agent-1")).toEqual(grant({ id: "agent-1" }));
    expect(() => requireGrant(ledger, "agent-9")).toThrow(
      /agent agent-9 holds no grant; register it with agent:register first/,
    );
  });
});

describe("replaceGrant", () => {
  test("replaces only the grant with a matching id, leaving the rest untouched", () => {
    const ledger = [grant({ id: "agent-1" }), grant({ id: "agent-2" })];
    const updated = grant({ id: "agent-1", status: "released" });
    const replaced = replaceGrant(ledger, updated);
    expect(replaced.find((g) => g.id === "agent-1")?.status).toBe("released");
    expect(replaced.find((g) => g.id === "agent-2")?.status).toBe("active");
  });
});

describe("assertAgentBudget", () => {
  test("allows issuing more grants while under budget", () => {
    expect(() => assertAgentBudget([grant(), grant({ id: "agent-2" })], 1, 5)).not.toThrow();
  });

  test("refuses to exceed the max_agents budget", () => {
    const ledger = [grant({ id: "agent-1" }), grant({ id: "agent-2" })];
    expect(() => assertAgentBudget(ledger, 1, 2)).toThrow(
      /max_agents budget of 2 is exhausted: 2 grants already issued and this needs 1 more/,
    );
  });
});

describe("knownTaskIds", () => {
  test("collects ids from both top-level tasks and branch sub-tasks", () => {
    const state: JsonObject = {
      tasks: { "T-1": {}, "T-2": {} },
      branches: [
        { id: "B-1", sub_tasks: [{ id: "T-1a" }, { id: "T-1b" }] },
        { id: "B-2" },
        "not-a-branch-object",
      ],
    };
    expect(knownTaskIds(state)).toEqual(new Set(["T-1", "T-2", "T-1a", "T-1b"]));
  });

  test("returns an empty set when there are no tasks or branches at all", () => {
    expect(knownTaskIds({})).toEqual(new Set());
  });

  test("ignores a sub_tasks entry that is not an object with a string id", () => {
    const state: JsonObject = {
      branches: [{ id: "B-1", sub_tasks: [{ id: 42 }, "not-an-object", { id: "T-1a" }] }],
    };
    expect(knownTaskIds(state)).toEqual(new Set(["T-1a"]));
  });
});
