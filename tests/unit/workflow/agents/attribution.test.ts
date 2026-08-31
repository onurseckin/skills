import { describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  assertAttribution,
  describeAttribution,
  resolveAttribution,
  resolveAttributionInLedger,
} from "../../../../olt/scripts/src/workflow/agents/attribution.ts";

function makeGrant(overrides: Partial<AgentGrantRecord> = {}): AgentGrantRecord {
  return {
    id: "worker-1",
    role: "implementer",
    status: "active",
    host: "antigravity",
    granted_at: "2026-08-31T00:00:00.000Z",
    parent_agent_id: null,
    parent_task_id: null,
    ...overrides,
  };
}

describe("workflow/agents/attribution", () => {
  describe("resolveAttributionInLedger", () => {
    test("returns empty-ledger when ledger is empty", () => {
      const res = resolveAttributionInLedger([], "worker-1");
      expect(res).toEqual({ kind: "unattributed", actor: "worker-1", reason: "empty-ledger" });
    });

    test("returns no-such-grant when actor is not found", () => {
      const ledger = [makeGrant({ id: "other-worker" })];
      const res = resolveAttributionInLedger(ledger, "worker-1");
      expect(res).toEqual({ kind: "unattributed", actor: "worker-1", reason: "no-such-grant" });
    });

    test("returns grant-released when actor exists but is not active", () => {
      const inactive = makeGrant({ id: "worker-1", status: "released", released_at: "2026-08-31T01:00:00.000Z" });
      const ledger = [inactive];
      const res = resolveAttributionInLedger(ledger, "worker-1");
      expect(res).toEqual({
        kind: "unattributed",
        actor: "worker-1",
        reason: "grant-released",
        releasedGrant: inactive,
      });
    });

    test("returns granted when active grant is present", () => {
      const grant = makeGrant({ id: "worker-1", status: "active" });
      const ledger = [grant];
      const res = resolveAttributionInLedger(ledger, "worker-1");
      expect(res).toEqual({
        kind: "granted",
        actor: "worker-1",
        grant,
      });
    });
  });

  describe("resolveAttribution", () => {
    test("reads ledger from state object", () => {
      const grant = makeGrant({ id: "worker-1" });
      const state = { agents: [grant] };
      const res = resolveAttribution(state, "worker-1");
      expect(res.kind).toBe("granted");
    });
  });

  describe("describeAttribution", () => {
    test("describes granted attribution", () => {
      const grant = makeGrant({ id: "worker-1", role: "implementer" });
      const desc = describeAttribution({ kind: "granted", actor: "worker-1", grant });
      expect(desc).toBe("actor worker-1 holds an active implementer grant");
    });

    test("describes empty-ledger unattributed reason", () => {
      const desc = describeAttribution({ kind: "unattributed", actor: "worker-1", reason: "empty-ledger" });
      expect(desc).toBe("actor worker-1 is unattributed: this capsule granted no agents at all");
    });

    test("describes no-such-grant unattributed reason", () => {
      const desc = describeAttribution({ kind: "unattributed", actor: "worker-1", reason: "no-such-grant" });
      expect(desc).toBe("actor worker-1 is unattributed: no grant was ever issued for this id");
    });

    test("describes grant-released with recorded released_at timestamp", () => {
      const inactive = makeGrant({ id: "worker-1", status: "released", released_at: "2026-08-31T01:00:00.000Z" });
      const desc = describeAttribution({
        kind: "unattributed",
        actor: "worker-1",
        reason: "grant-released",
        releasedGrant: inactive,
      });
      expect(desc).toBe(
        "actor worker-1 is unattributed: its grant was released and can no longer attribute new work (released at 2026-08-31T01:00:00.000Z)",
      );
    });

    test("describes grant-released with undefined released_at timestamp", () => {
      const inactive = makeGrant({ id: "worker-1", status: "released", released_at: undefined });
      const desc = describeAttribution({
        kind: "unattributed",
        actor: "worker-1",
        reason: "grant-released",
        releasedGrant: inactive,
      });
      expect(desc).toBe(
        "actor worker-1 is unattributed: its grant was released and can no longer attribute new work (released at an unrecorded time)",
      );
    });
  });

  describe("assertAttribution", () => {
    test("returns grant if actor holds active grant", () => {
      const grant = makeGrant({ id: "worker-1" });
      const state = { agents: [grant] };
      expect(assertAttribution(state, "worker-1")).toEqual(grant);
    });

    test("throws INVALID_STATE HarnessError with guidance when actor is unattributed", () => {
      const state = { agents: [] };
      expect(() => assertAttribution(state, "worker-1")).toThrow(HarnessError);
      try {
        assertAttribution(state, "worker-1");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HarnessError);
        const he = err as HarnessError;
        expect(he.code).toBe("INVALID_STATE");
        expect(he.fix).toContain("agent:register");
      }
    });
  });
});
