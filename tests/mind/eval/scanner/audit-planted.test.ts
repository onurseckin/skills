import { afterEach, describe, expect, test } from "bun:test";
import { setupMindCapsule, roots } from "./audit-fixture.ts";
import type { HarnessEvent } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { checkPulseGaps } from "../../../../olt/scripts/src/mind/auditing/index.ts";

afterEach(() => {
  roots.length = 0;
});

describe("PHASE-5 §4.1 & PLAN §13.7 Planted-Ledger Audit Test Suite", () => {
  describe("Planted Defect 1: Pulse Gaps (Open Without Close, Double Opens, Sequence Jumps)", () => {
    test("detects unclosed pulse gap and reports missing close", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T01:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-opened",
          payload: { pulse_id: "pulse-1" },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const res = checkPulseGaps(events);
      expect(res.ok).toBe(false);
      expect(res.gaps.length).toBeGreaterThan(0);
    });

    test("detects close event without corresponding open event", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T01:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-1" },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const res = checkPulseGaps(events);
      expect(res.ok).toBe(false);
    });

    test("detects sequence number jump (pulse-1 then pulse-3 skipping pulse-2)", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T01:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-opened",
          payload: { pulse_id: "pulse-1" },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 2,
          revision: 1,
          timestamp: "2026-08-21T01:10:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-1" },
          previous_hash: "h1",
          projection: null,
          hash: "h2",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 3,
          revision: 1,
          timestamp: "2026-08-21T01:20:00Z",
          actor: "mind-1",
          kind: "mind-pulse-opened",
          payload: { pulse_id: "pulse-3" },
          previous_hash: "h2",
          projection: null,
          hash: "h3",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 4,
          revision: 1,
          timestamp: "2026-08-21T01:30:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-3" },
          previous_hash: "h3",
          projection: null,
          hash: "h4",
        },
      ];

      const res = checkPulseGaps(events);
      expect(res.ok).toBe(false);
    });
  });
});
