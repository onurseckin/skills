import { describe, expect, test } from "bun:test";
import {
  aggregateDefectEntries,
  toAggregatedDefect,
  withinDeduplicationWindow,
} from "../../../olt/scripts/src/defects/aggregator.ts";
import type {
  DefectRecordInput,
  DefectResolutionProof,
} from "../../../olt/scripts/src/defects/types.ts";

describe("Defect Entry Aggregator", () => {
  describe("toAggregatedDefect", () => {
    test("initializes an aggregated defect record from raw input", () => {
      const input: DefectRecordInput = {
        id: "b-raw-1",
        type: "role_confinement_violation",
        category: "boundary_violation",
        severity: "critical",
        timestamp: "2026-08-22T08:00:00.000Z",
        observation: "Orchestrator attempted to claim task directly",
        remediation: "Dispatch Tier 3 worker",
        agent_id: "orch-01",
        pid: 1234,
      };

      const aggregated = toAggregatedDefect(input);

      expect(aggregated.id).toBe("b-raw-1");
      expect(aggregated.count).toBe(1);
      expect(aggregated.first_seen_at).toBe("2026-08-22T08:00:00.000Z");
      expect(aggregated.last_seen_at).toBe("2026-08-22T08:00:00.000Z");
      expect(aggregated.status).toBe("open");
      expect(aggregated.category).toBe("boundary_violation");
      expect(aggregated.occurrences?.length).toBe(1);
      expect(aggregated.occurrences?.[0]?.pid).toBe(1234);
    });
  });

  describe("aggregateDefectEntries", () => {
    test("increments count and updates timestamps correctly", () => {
      const base: DefectRecordInput = {
        id: "b-base",
        type: "type_error",
        severity: "warning",
        timestamp: "2026-08-22T08:00:00.000Z",
        observation: "Implicit any",
        remediation: "Add annotation",
      };

      const target = toAggregatedDefect(base);

      const incoming: DefectRecordInput = {
        type: "type_error",
        severity: "warning",
        timestamp: "2026-08-22T08:05:00.000Z",
        observation: "Implicit any",
        remediation: "Add annotation",
      };

      const updated = aggregateDefectEntries(target, incoming);

      expect(updated.count).toBe(2);
      expect(updated.first_seen_at).toBe("2026-08-22T08:00:00.000Z");
      expect(updated.last_seen_at).toBe("2026-08-22T08:05:00.000Z");
      expect(updated.occurrences?.length).toBe(2);
    });

    test("upgrades severity when incoming is higher severity", () => {
      const target = toAggregatedDefect({
        type: "syntax_defect",
        severity: "warning",
        observation: "Syntax issue",
      });

      const incoming: DefectRecordInput = {
        type: "syntax_defect",
        severity: "critical",
        observation: "Syntax issue",
      };

      const updated = aggregateDefectEntries(target, incoming);
      expect(updated.severity).toBe("critical");
    });

    test("preserves resolved status and resolution proof", () => {
      const target = toAggregatedDefect({
        type: "code_defect",
        severity: "warning",
        status: "open",
        observation: "Defect",
      });

      const proof: DefectResolutionProof = {
        task_id: "task-fix-1",
        test_assertion: "bun test tests/unit/fix.test.ts",
        resolved_at: "2026-08-22T08:30:00.000Z",
      };

      const incoming: DefectRecordInput = {
        type: "code_defect",
        status: "resolved",
        resolution: proof,
        observation: "Defect",
      };

      const updated = aggregateDefectEntries(target, incoming);
      expect(updated.status).toBe("resolved");
      expect(updated.resolution?.task_id).toBe("task-fix-1");
    });

    test("bounds occurrences list to maximum limit", () => {
      let current = toAggregatedDefect({
        type: "spam_error",
        observation: "Rapid loop error",
      });

      for (let i = 0; i < 60; i += 1) {
        current = aggregateDefectEntries(
          current,
          {
            type: "spam_error",
            observation: "Rapid loop error",
            timestamp: `2026-08-22T09:${i < 10 ? "0" + i : i}:00.000Z`,
          },
          { maxOccurrences: 10 },
        );
      }

      expect(current.count).toBe(61);
      expect(current.occurrences?.length).toBe(10);
    });
  });

  describe("withinDeduplicationWindow", () => {
    test("evaluates window correctly", () => {
      const t1 = "2026-08-22T10:00:00.000Z";
      const t2 = "2026-08-22T10:00:30.000Z";
      const t3 = "2026-08-22T10:02:00.000Z";

      expect(withinDeduplicationWindow(t1, t2, 60_000)).toBeTrue();
      expect(withinDeduplicationWindow(t1, t3, 60_000)).toBeFalse();
    });
  });
});
