/**
 * @file aggregator.test.ts
 * Unit tests for Defect Aggregation, Deduplication Windows, and Metrics
 */

import { describe, expect, it } from "bun:test";
import {
  aggregateDefectEntries,
  calculateDefectAggregateMetrics,
  clusterDefectsBySimilarity,
  mergeDefectSets,
  toAggregatedDefect,
  withinDeduplicationWindow,
} from "../../../../olt/scripts/src/mind/defects/aggregator/index.ts";
import type {
  AggregatedDefect,
  DefectRecordInput,
} from "../../../../olt/scripts/src/mind/defects/core/index.ts";

describe("Defect Aggregator Suite", () => {
  describe("withinDeduplicationWindow", () => {
    it("returns true when windowMs <= 0", () => {
      expect(withinDeduplicationWindow("2026-08-24T00:00:00Z", "2026-08-25T00:00:00Z", 0)).toBe(
        true,
      );
      expect(withinDeduplicationWindow("2026-08-24T00:00:00Z", "2026-08-25T00:00:00Z", -10)).toBe(
        true,
      );
    });

    it("evaluates window correctly within threshold and outside threshold", () => {
      const t1 = "2026-08-24T12:00:00.000Z";
      const t2 = "2026-08-24T12:00:30.000Z";
      const t3 = "2026-08-24T12:05:00.000Z";

      expect(withinDeduplicationWindow(t1, t2, 60_000)).toBe(true);
      expect(withinDeduplicationWindow(t1, t3, 60_000)).toBe(false);
    });
  });

  describe("toAggregatedDefect", () => {
    it("converts complete input into AggregatedDefect", () => {
      const input: DefectRecordInput = {
        id: "defect-001",
        type: "api_timeout",
        severity: "CRITICAL",
        category: "boundary_violation",
        status: "open",
        timestamp: "2026-08-24T10:00:00.000Z",
        first_seen_at: "2026-08-24T09:00:00.000Z",
        last_seen_at: "2026-08-24T10:00:00.000Z",
        count: 3,
        observation: "Worker breached lease boundaries",
        remediation: "Terminate worker",
        role: "implementer",
        agent_id: "agent-123",
        pid: 100,
        ppid: 1,
        context: { lane: "default" },
      };

      const result = toAggregatedDefect(input);
      expect(result.id).toBe("defect-001");
      expect(result.severity).toBe("critical");
      expect(result.category).toBe("boundary_violation");
      expect(result.status).toBe("open");
      expect(result.count).toBe(3);
      expect(result.first_seen_at).toBe("2026-08-24T09:00:00.000Z");
      expect(result.occurrences.length).toBe(1);
    });

    it("handles alternative categories and statuses", () => {
      const r1 = toAggregatedDefect({
        category: "role_confusion",
        status: "RESOLVED",
        prescribed_remediation: "Reassign role",
      });
      expect(r1.category).toBe("boundary_violation");
      expect(r1.status).toBe("resolved");

      const r2 = toAggregatedDefect({
        category: "model_reasoning_error",
        status: "wontfix",
        message: "Hallucinated file",
      });
      expect(r2.category).toBe("model_reasoning_error");
      expect(r2.status).toBe("wontfix");
    });
  });

  describe("aggregateDefectEntries", () => {
    it("merges target defect with incoming defect", () => {
      const target = toAggregatedDefect({
        id: "defect-001",
        type: "syntax_error",
        severity: "warning",
        status: "open",
        first_seen_at: "2026-08-24T10:00:00Z",
        last_seen_at: "2026-08-24T10:00:00Z",
        count: 1,
        context: { env: "prod" },
      });

      const incoming: DefectRecordInput = {
        severity: "critical",
        status: "resolved",
        timestamp: "2026-08-24T11:00:00Z",
        first_seen_at: "2026-08-24T09:00:00Z",
        last_seen_at: "2026-08-24T11:00:00Z",
        count: 2,
        context: { runId: "run-99" },
      };

      const updated = aggregateDefectEntries(target, incoming, { maxOccurrences: 10 });
      expect(updated.count).toBe(3);
      expect(updated.severity).toBe("critical");
      expect(updated.status).toBe("resolved");
      expect(updated.first_seen_at).toBe("2026-08-24T09:00:00Z");
      expect(updated.last_seen_at).toBe("2026-08-24T11:00:00Z");
    });
  });

  describe("mergeDefectSets", () => {
    it("merges and deduplicates sets of defects", () => {
      const d1 = toAggregatedDefect({
        type: "timeout",
        observation: "Query timed out",
        agent_id: "agent-1",
      });

      const d2 = toAggregatedDefect({
        type: "validation",
        observation: "Schema error",
        agent_id: "agent-2",
      });

      const incoming: DefectRecordInput = {
        type: "timeout",
        observation: "Query timed out",
        agent_id: "agent-1",
        count: 2,
      };

      const merged = mergeDefectSets([d1, d2], [incoming]);
      expect(merged.length).toBe(2);

      const timeoutDefect = merged.find((d) => d.type === "timeout");
      expect(timeoutDefect?.count).toBe(3);
    });
  });

  describe("calculateDefectAggregateMetrics", () => {
    it("computes accurate aggregate metrics across statuses and categories", () => {
      const defects: AggregatedDefect[] = [
        toAggregatedDefect({ category: "code_defect", severity: "high", status: "open", count: 3 }),
        toAggregatedDefect({
          category: "boundary_violation",
          severity: "critical",
          status: "resolved",
          count: 1,
        }),
        toAggregatedDefect({
          category: "model_reasoning_error",
          severity: "warning",
          status: "wontfix",
          count: 1,
        }),
      ];

      const metrics = calculateDefectAggregateMetrics(defects);
      expect(metrics.total_recorded).toBe(5);
      expect(metrics.unique_defects).toBe(3);
      expect(metrics.open_count).toBe(1);
      expect(metrics.resolved_count).toBe(1);
      expect(metrics.wontfix_count).toBe(1);
    });
  });

  describe("clusterDefectsBySimilarity", () => {
    it("groups similar defects with same category into clusters", () => {
      const d1 = toAggregatedDefect({
        category: "code_defect",
        type: "connection_timeout",
        observation: "Database connection failed with timeout 5000ms",
      });

      const d2 = toAggregatedDefect({
        category: "code_defect",
        type: "connection_timeout",
        observation: "Database connection failed with timeout 10000ms",
      });

      const d3 = toAggregatedDefect({
        category: "boundary_violation",
        type: "lease_breach",
        observation: "Agent wrote to disallowed path",
      });

      const clusters = clusterDefectsBySimilarity([d1, d2, d3], 0.4);
      expect(clusters.length).toBe(2);
      expect(clusters[0]?.length).toBe(2);
      expect(clusters[1]?.length).toBe(1);
    });
  });
});
