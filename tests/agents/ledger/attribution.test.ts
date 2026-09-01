import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  describeAttribution,
  resolveAttribution,
  resolveAttributionInLedger,
} from "../../../olt/scripts/src/workflow/agents/attribution.ts";
import { assertAttribution } from "../../../olt/scripts/src/workflow/agents/index.ts";
import { cleanupVirtualAgentsFS, setupVirtualAgentsFS } from "../fixture.ts";

beforeEach(() => {
  setupVirtualAgentsFS();
});

afterEach(() => {
  cleanupVirtualAgentsFS();
});

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

function released(overrides: Partial<AgentGrantRecord> = {}): AgentGrantRecord {
  return grant({
    status: "released",
    released_at: "2026-08-20T00:00:00.000Z",
    release_reason: "done",
    ...overrides,
  });
}

function stateWith(...ledger: AgentGrantRecord[]): JsonObject {
  return { agents: ledger };
}

function caughtHarnessError(call: () => unknown): HarnessError {
  try {
    call();
  } catch (error) {
    if (error instanceof HarnessError) return error;
    throw error;
  }
  throw new Error("expected the call to throw a HarnessError");
}

describe("resolveAttribution", () => {
  test("an actor holding an active grant resolves to granted and carries that grant", () => {
    const result = resolveAttribution(stateWith(grant({ id: "agent-1" })), "agent-1");
    expect(result.kind).toBe("granted");
    if (result.kind !== "granted") throw new Error("expected a granted attribution");
    expect(result.actor).toBe("agent-1");
    expect(result.grant.id).toBe("agent-1");
    expect(result.grant.status).toBe("active");
  });

  test("an actor absent from the ledger resolves to unattributed, never to granted", () => {
    const result = resolveAttribution(stateWith(grant({ id: "agent-1" })), "agent-9");
    expect(result.kind).toBe("unattributed");
    if (result.kind !== "unattributed") throw new Error("expected an unattributed attribution");
    expect(result.reason).toBe("no-such-grant");
    expect(result.actor).toBe("agent-9");
    expect(result).not.toHaveProperty("grant");
  });

  test("an empty agents ledger attributes nothing, vacuously granting no actor", () => {
    const empty = stateWith();
    for (const actor of ["agent-1", "coordinator", "anything-at-all"]) {
      const result = resolveAttribution(empty, actor);
      expect(result.kind).toBe("unattributed");
      if (result.kind !== "unattributed") throw new Error("expected an unattributed attribution");
      expect(result.reason).toBe("empty-ledger");
      expect(result.actor).toBe(actor);
    }
  });

  test("a state carrying no agents key at all resolves every actor to unattributed", () => {
    const result = resolveAttribution({}, "agent-1");
    expect(result.kind).toBe("unattributed");
    if (result.kind !== "unattributed") throw new Error("expected an unattributed attribution");
    expect(result.reason).toBe("empty-ledger");
  });

  test("a blank actor searched against a populated ledger matches no grant", () => {
    const populated = stateWith(grant({ id: "agent-1" }), released({ id: "agent-2" }));
    for (const actor of ["", "   "]) {
      const result = resolveAttribution(populated, actor);
      expect(result.kind).toBe("unattributed");
      if (result.kind !== "unattributed") throw new Error("expected an unattributed attribution");
      expect(result.reason).toBe("no-such-grant");
      expect(result.actor).toBe(actor);
    }
  });

  test("a released grant is unattributed but stays distinguishable from an id that never held one", () => {
    const gone = released({ id: "agent-1" });
    const result = resolveAttribution(stateWith(gone), "agent-1");
    expect(result.kind).toBe("unattributed");
    if (result.kind !== "unattributed") throw new Error("expected an unattributed attribution");
    expect(result.reason).toBe("grant-released");
    if (result.reason !== "grant-released") throw new Error("expected a released-grant reason");
    expect(result.releasedGrant).toEqual(gone);

    const stranger = resolveAttribution(stateWith(gone), "agent-9");
    if (stranger.kind !== "unattributed") throw new Error("expected an unattributed attribution");
    expect(stranger.reason).toBe("no-such-grant");
    expect(stranger.reason).not.toBe(result.reason);
  });

  test("the released grant rides only on the grant-released reason, never on the other two", () => {
    expect(resolveAttribution({}, "agent-1")).not.toHaveProperty("releasedGrant");
    expect(resolveAttribution(stateWith(grant()), "agent-9")).not.toHaveProperty("releasedGrant");
    expect(resolveAttribution(stateWith(grant()), "agent-1")).not.toHaveProperty("releasedGrant");
    expect(resolveAttribution(stateWith(released()), "agent-1")).toHaveProperty("releasedGrant");
  });

  test("a role name is not an agent id, so mechanic-validator matches no grant in a real ledger", () => {
    const state = stateWith(
      grant({ id: "implementer_cand-5-attr" }),
      grant({ id: "validator-1", role: "mechanic-validator" }),
    );
    const result = resolveAttribution(state, "mechanic-validator");
    expect(result.kind).toBe("unattributed");
    if (result.kind !== "unattributed") throw new Error("expected an unattributed attribution");
    expect(result.reason).toBe("no-such-grant");
    expect(result.actor).toBe("mechanic-validator");
  });

  test("both outcomes are returnable values, so historical ungranted artifacts stay replayable", () => {
    const state = stateWith(grant({ id: "agent-1" }));
    const kinds = ["agent-1", "mechanic-validator", "agent-9"].map(
      (actor) => resolveAttribution(state, actor).kind,
    );
    expect(kinds).toEqual(["granted", "unattributed", "unattributed"]);
  });

  test("a malformed ledger raises an integrity failure rather than masquerading as unattributed", () => {
    expect(() => resolveAttribution({ agents: "not-an-array" }, "agent-1")).toThrow(
      /state\.agents must be an array/,
    );
    expect(() => resolveAttribution({ agents: [{ id: "agent-1" }] }, "agent-1")).toThrow(
      /state\.agents\[0\] is not an agent grant record/,
    );
  });
});

describe("resolveAttributionInLedger", () => {
  test("resolves against an already-read ledger without touching state", () => {
    const ledger = [grant({ id: "agent-1" }), released({ id: "agent-2" })];
    expect(resolveAttributionInLedger(ledger, "agent-1").kind).toBe("granted");
    expect(resolveAttributionInLedger(ledger, "agent-2").kind).toBe("unattributed");
    expect(resolveAttributionInLedger([], "agent-1").kind).toBe("unattributed");
  });

  test("duplicate ids resolve the same way in either order, never granting on array position", () => {
    const active = grant({ id: "dup" });
    const gone = released({ id: "dup" });
    for (const ledger of [
      [active, gone],
      [gone, active],
    ]) {
      const result = resolveAttributionInLedger(ledger, "dup");
      expect(result.kind).toBe("unattributed");
      if (result.kind !== "unattributed") throw new Error("expected an unattributed attribution");
      expect(result.reason).toBe("grant-released");
      if (result.reason !== "grant-released") throw new Error("expected a released-grant reason");
      expect(result.releasedGrant).toEqual(gone);
    }
  });
});

describe("describeAttribution", () => {
  test("names the reason a result is unattributed instead of collapsing every case into one line", () => {
    expect(describeAttribution(resolveAttribution(stateWith(released()), "agent-1"))).toMatch(
      /grant was released/,
    );
    expect(
      describeAttribution(resolveAttribution(stateWith(released()), "mechanic-validator")),
    ).toMatch(/no grant was ever issued/);
    expect(describeAttribution(resolveAttribution({}, "agent-1"))).toMatch(
      /granted no agents at all/,
    );
    expect(
      describeAttribution(resolveAttribution(stateWith(grant({ id: "agent-1" })), "agent-1")),
    ).toMatch(/holds an active implementer grant/);
  });

  test("reads the release timestamp off the released grant it was handed", () => {
    expect(describeAttribution(resolveAttribution(stateWith(released()), "agent-1"))).toContain(
      "released at 2026-08-20T00:00:00.000Z",
    );
    const undated = grant({ status: "released" });
    expect(describeAttribution(resolveAttribution(stateWith(undated), "agent-1"))).toContain(
      "released at an unrecorded time",
    );
  });
});

describe("assertAttribution (imported from the agents barrel)", () => {
  test("returns the grant for an actively granted actor", () => {
    const granted = grant({ id: "agent-1" });
    expect(assertAttribution(stateWith(granted), "agent-1")).toEqual(granted);
  });

  test("refuses an actor that never held a grant, and says so in a parseable payload", () => {
    const error = caughtHarnessError(() =>
      assertAttribution(stateWith(grant({ id: "agent-1" })), "mechanic-validator"),
    );
    expect(error.code).toBe("INVALID_STATE");
    expect(error.message).toMatch(
      /actor mechanic-validator is unattributed: no grant was ever issued for this id/,
    );
    expect(error.issues).toEqual([{ actor: "mechanic-validator", reason: "no-such-grant" }]);
    expect(error.fix).toMatch(/agent id that holds the grant/);
  });

  test("refuses every actor when the ledger is empty or absent", () => {
    const empty = caughtHarnessError(() => assertAttribution(stateWith(), "agent-1"));
    expect(empty.message).toMatch(/this capsule granted no agents at all/);
    expect(empty.issues).toEqual([{ actor: "agent-1", reason: "empty-ledger" }]);

    const absent = caughtHarnessError(() => assertAttribution({}, "agent-1"));
    expect(absent.code).toBe("INVALID_STATE");
    expect(absent.issues).toEqual([{ actor: "agent-1", reason: "empty-ledger" }]);
  });

  test("refuses an actor whose grant was released", () => {
    const error = caughtHarnessError(() => assertAttribution(stateWith(released()), "agent-1"));
    expect(error.code).toBe("INVALID_STATE");
    expect(error.message).toMatch(/its grant was released and can no longer attribute new work/);
    expect(error.issues).toEqual([{ actor: "agent-1", reason: "grant-released" }]);
  });
});
