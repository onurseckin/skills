import { describe, expect, spyOn, test } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import { registerAgentGrant } from "../../../../olt/scripts/src/workflow/agents/grants.ts";
import { readAgentLedger } from "../../../../olt/scripts/src/workflow/agents/ledger.ts";
import { FakeRunStore } from "../../branch/fixtures/fake-transact.ts";

async function raceConditionalGenesis(
  firstId: string,
  secondId: string,
): Promise<readonly { readonly ok: boolean; readonly code?: string }[]> {
  const store = new FakeRunStore();
  const spy = spyOn(storeModule, "transact").mockImplementation(store.transact);

  try {
    const register = async (agentId: string) => {
      try {
        registerAgentGrant({
          runRoot: store.runRoot,
          agentId,
          role: "coordinator",
          parentAgentId: null,
          parentTaskId: null,
          host: "fixture",
          authority: { kind: "conditional_genesis" },
          maxAgents: 10,
          telemetry: {},
        });
        return { ok: true };
      } catch (error: unknown) {
        return {
          ok: false,
          ...(error instanceof HarnessError ? { code: error.code } : {}),
        };
      }
    };

    const results = await Promise.all([register(firstId), register(secondId)]);
    const state = store.read();
    expect(readAgentLedger(state).filter((grant) => grant.status === "active")).toHaveLength(1);
    expect(store.events.filter((event) => event.kind === "agent-registered")).toHaveLength(1);
    return results;
  } finally {
    spy.mockRestore();
  }
}

describe("workflow/agents/grants: concurrency races in-memory", () => {
  test("serializes same-run conditional-genesis racers for distinct and identical agent ids", async () => {
    for (const [firstId, secondId] of [
      ["genesis-distinct-a", "genesis-distinct-b"],
      ["genesis-same", "genesis-same"],
    ]) {
      const results = await raceConditionalGenesis(firstId, secondId);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)[0]?.code).toBe(
        firstId === secondId ? "INVALID_STATE" : "AUTHENTICATION_FAILURE",
      );
    }
  });
});
