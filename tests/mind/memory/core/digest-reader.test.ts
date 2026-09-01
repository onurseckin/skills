/**
 * Unit Test Suite for Memory Digest Reader and Signal Extraction.
 * Covers extractRunSignals and readMemoryDigest.
 */

import { describe, expect, it } from "bun:test";
import {
  extractRunSignals,
  readMemoryDigest,
} from "../../../../olt/scripts/src/mind/memory/digest/reader.ts";
import type { TrailingValueSeries } from "../../../../olt/scripts/src/mind/lifecycle/interval/index.ts";

describe("Digest Reader & Signal Extraction", () => {
  describe("extractRunSignals - Escalations & Tasks", () => {
    it("extracts active escalations, task-level escalations, and findings", () => {
      const state: Record<string, unknown> = {
        escalations: [
          {
            id: "esc-1",
            task_id: "task-100",
            reason: "blocked on credentials",
            evidence: "HTTP 401 unauthorized",
            escalated_at: "2026-09-01T12:00:00Z",
            command_id: "cmd-auth",
            event_index: 4,
          },
          { id: "esc-2", resolved_at: "2026-09-01T12:30:00Z", reason: "already resolved" },
          { resolved_at: null, command_source: "cmd-source-fallback", event_sequence: 9 },
          null,
        ],
        findings: [
          {
            id: "finding-global-1",
            observation: "global missing null check",
            remediation: "add optional chaining",
            revalidation_gate: "gate-typecheck",
            severity: "high",
            command_source: "cmd-lint",
            event_sequence: 15,
          },
        ],
        tasks: {
          "task-100": { status: "escalated", escalation_reason: "duplicate ignored" },
          "task-new": {
            status: "escalated",
            escalation_id: "esc-custom-id",
            escalation_reason: "resource exhausted",
            escalation_evidence: "OOM killed",
            last_command_id: "cmd-compile",
            event_index: 12,
          },
          "task-source-fallback": { status: "escalated", command_source: "cmd-source-alt" },
          "task-audit": {
            open_finding_ids: ["finding-local-1", "finding-global-1", "finding-missing", 123],
            findings: [
              {
                id: "finding-local-1",
                observation: "local file unclosed",
                remediation: "use using statement",
                revalidation: "gate-unit",
                severity: "medium",
                command_id: "cmd-test",
                event_index: 3,
              },
            ],
          },
          "task-cr": {
            status: "changes_requested",
            reason: "needs test coverage",
            last_command_id: "cmd-review",
            event_index: 8,
          },
          "task-cr-alt": { status: "changes_requested", command_id: "cmd-cr-alt" },
        },
      };

      const result = extractRunSignals(state, "run-alpha");
      expect(result.escalations.length).toBe(4);
      expect(result.findings.length).toBe(5);
      expect(result.findings.find((f) => f.findingId === "finding-local-1")).toMatchObject({
        observation: "local file unclosed",
        remediation: "use using statement",
        revalidationGate: "gate-unit",
        severity: "medium",
        commandSource: "cmd-test",
        eventIndex: 3,
      });
      expect(result.findings.find((f) => f.findingId === "finding-missing")?.observation).toBe(
        "open review finding awaiting remediation",
      );
    });

    it("extracts findings from state.findings object map", () => {
      const state: Record<string, unknown> = {
        findings: { "f-map": { id: "f-map", observation: "map finding" } },
        tasks: { "task-m": { open_finding_ids: ["f-map"] } },
      };
      const result = extractRunSignals(state);
      expect(result.findings[0]?.observation).toBe("map finding");
    });
  });

  describe("extractRunSignals - Gates, Candidates, and Proposals", () => {
    it("extracts failing gates and candidates across mind and state structures", () => {
      const state: Record<string, unknown> = {
        gates: [
          {
            id: "gate-fail-1",
            status: "failed",
            command: "bun build",
            exit_code: 1,
            failure_snippet: "syntax error on line 42",
            command_id: "cmd-gate-1",
            event_index: 20,
          },
          { id: "gate-pass", status: "passed", exit_code: 0 },
        ],
        graph: {
          gates: [
            { id: "gate-fail-1", status: "failed", exit_code: 1 },
            {
              id: "gate-fail-2",
              exit_code: 2,
              argv: ["bun", "test"],
              failure_output: "1 test failed",
              command_source: "cmd-test-gate",
              event_sequence: 25,
            },
            { exit_code: 137, command: ["timeout", "60", "run"] },
          ],
        },
        mind: {
          candidates: [
            {
              id: "cand-declined-1",
              title: "Declined memory candidate",
              rationale: "Exceeds complexity budget",
              status: "declined",
              decline_reason: "rejected by charter rule",
              witness: { command_id: "cmd-witness-1" },
              event_index: 10,
              declined_at: "2026-09-01T12:00:00Z",
            },
            {
              id: "cand-proposed-1",
              statement: "Open proposal candidate",
              kind: "proposal",
              charter_goal: "G1",
              witness: "cmd-witness-2",
              created_at: "2026-09-01T12:05:00Z",
            },
          ],
        },
        candidates: [
          {
            id: "cand-declined-2",
            objective: "Candidate 2",
            disposition: "declined",
            declined_reason: "redundant",
            witness_command_id: "cmd-w-2",
          },
          {
            id: "cand-auth-1",
            status: "needs_authority",
            command_source: "cmd-w-3",
            event_sequence: 30,
          },
        ],
        requirements: {
          requirements: [
            {
              id: "req-auth-1",
              disposition: "needs_authority",
              instruction: "Manual intervention required",
              command_id: "cmd-req",
              event_index: 35,
            },
          ],
        },
      };

      const result = extractRunSignals(state, "run-all-signals");
      expect(result.gates.length).toBe(3);
      expect(result.declinedCandidates.length).toBe(2);
      expect(result.declinedCandidates[0]).toMatchObject({
        candidateId: "cand-declined-1",
        declineReason: "rejected by charter rule",
        witnessCommandId: "cmd-witness-1",
      });
      expect(result.declinedCandidates[1]).toMatchObject({
        candidateId: "cand-declined-2",
        declineReason: "redundant",
      });
      expect(result.openProposals.length).toBe(3); // cand-proposed-1 + cand-auth-1 + req-auth-1
      expect(result.openProposals.some((p) => p.proposalId === "req-auth-1")).toBe(true);
    });

    it("handles dictionary candidates and requirements object map", () => {
      const state: Record<string, unknown> = {
        candidates: {
          c1: { id: "c-map", status: "declined", reason: "no bandwidth" },
          c2: { id: "c-prop", status: "proposed", requirement_id: "req-99", proposed_at: "now" },
        },
        requirements: {
          r1: { id: "r-map", disposition: "needs_authority", label: "label instruction" },
        },
      };
      const result = extractRunSignals(state);
      expect(result.declinedCandidates.length).toBe(1);
      expect(result.openProposals.length).toBe(2);
    });
  });

  describe("readMemoryDigest", () => {
    it("returns default structured digest when options are empty", () => {
      const digest = readMemoryDigest();
      expect(digest.runId).toBe("mind");
      expect(typeof digest.generatedAt).toBe("string");
      expect(digest.findings).toEqual([]);
      expect(digest.trailingSeries.points).toEqual([]);
    });

    it("returns fully assembled digest with custom options and trailing series", () => {
      const mockTrailing: TrailingValueSeries = {
        unit: "count",
        points: [{ timestamp: "2026-09-01T10:00:00Z", value: 42 }],
        windowMinutes: 60,
      };

      const digest = readMemoryDigest({
        runId: "run-custom-42",
        state: { escalations: [{ id: "esc-main", reason: "manual block" }] },
        trailingSeries: mockTrailing,
      });

      expect(digest.runId).toBe("run-custom-42");
      expect(digest.escalations.length).toBe(1);
      expect(digest.trailingSeries.points[0]?.value).toBe(42);
    });
  });
});
