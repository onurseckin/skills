import { describe, expect, it, test } from "bun:test";
import {
  checkAdmittedCandidateGoals,
  checkAdmittedCandidateWitnesses,
  checkCharterDigestIntegrity,
  checkDeclinedCandidates,
  checkNeverUnattendedActions,
  checkPulseGaps,
  checkScopeViolations,
  checkValueConsistency,
} from "../../../../olt/scripts/src/mind/auditing/index.ts";

describe("Phase 5 W5.2 - Mind Audit Verification Functions", () => {
  describe("8 Verification Check Functions", () => {
    test("Q1 checkPulseGaps detects gaps in open/close pairs and sequence jumps", () => {
      const cleanEvents: HarnessEvent[] = [
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
      ];

      const cleanResult = checkPulseGaps(cleanEvents);
      expect(cleanResult.ok).toBe(true);
      expect(cleanResult.gaps).toHaveLength(0);

      const defectiveEvents: HarnessEvent[] = [
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
          payload: { pulse_id: "pulse-3" },
          previous_hash: "h1",
          projection: null,
          hash: "h2",
        },
      ];

      const defResult = checkPulseGaps(defectiveEvents);
      expect(defResult.ok).toBe(false);
      expect(defResult.gaps.some((g) => g.includes("opened but never closed"))).toBe(true);
      expect(defResult.gaps.some((g) => g.includes("no open event"))).toBe(true);
    });

    test("Q3 checkAdmittedCandidateGoals detects invalid charter goals", () => {
      const stateWithInvalidGoal = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 5,
        event_head: "h5",
        candidates: [
          {
            id: "cand-1",
            status: "admitted",
            charter_goal_ids: ["G1", "G99_INVALID"],
          },
        ],
      } as unknown as RunState;

      const result = checkAdmittedCandidateGoals(stateWithInvalidGoal, [], ["G1", "G2"]);
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain("non-existent charter goal 'G99_INVALID'");
    });

    test("Q4 checkValueConsistency verifies value matches ledger computation", () => {
      const eventsWithValue: HarnessEvent[] = [
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
          payload: {
            pulse_id: "pulse-1",
            value: 100,
            metrics: {
              leases_reclaimed: 1,
              findings_resolved: 0,
              gates_flipped_red_to_green: 0,
              tasks_reaching_done: 0,
              candidates_admitted: 0,
              proposals_recorded: 0,
            },
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkValueConsistency(eventsWithValue, {} as unknown as RunState);
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain("inconsistent with ledger metrics");
    });

    test("Q6 checkNeverUnattendedActions catches prohibited command patterns", () => {
      const eventsWithProhibited: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T01:00:00Z",
          actor: "worker-1",
          kind: "run-exec",
          payload: {
            command: "git push --force origin main",
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkNeverUnattendedActions(eventsWithProhibited, {} as unknown as RunState);
      expect(result.ok).toBe(false);
      expect(result.violations[0]).toContain("prohibited never-unattended command");
    });

    test("Q7 checkDeclinedCandidates checks non-empty decline reason", () => {
      const stateWithDeclined = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 2,
        event_head: "h2",
        candidates: [
          {
            id: "cand-1",
            status: "declined",
            decline_reason: "   ",
          },
        ],
      } as unknown as RunState;

      const result = checkDeclinedCandidates(stateWithDeclined, []);
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain("missing a non-empty decline reason");
    });

    test("Q8 checkCharterDigestIntegrity detects unauthorized charter sha drift", () => {
      const stateWithPinned = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: "h1",
        mind: {
          charter: {
            pinned_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
      } as unknown as RunState;

      const result = checkCharterDigestIntegrity(stateWithPinned, [], {
        currentSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      });

      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain("without recorded owner decision");
    });
  });
});
