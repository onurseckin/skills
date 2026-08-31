import { describe, expect, it } from "bun:test";
import {
  aggregateDefectEntries,
  calculateDefectAggregateMetrics,
  calculateDefectSimilarity,
  clusterDefectsBySimilarity,
  extractDefectKeywords,
  mergeDefectSets,
  toAggregatedDefect,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import type {
  AggregatedDefect,
  DefectRecordInput,
} from "../../../olt/scripts/src/mind/defects/core/index.ts";

export const clusteringSuiteName = "Defect Clustering, Similarity & Statistical Aggregation";

describe(clusteringSuiteName, () => {
  it("converts input to complete AggregatedDefect", () => {
    const input: DefectRecordInput = {
      id: "defect-001",
      type: "unauthorized_edit",
      severity: "high",
      category: "boundary_violation",
      observation: "Attempted edit without lease",
      agent_id: "agent-alpha",
      pid: 4001,
    };

    const aggregated = toAggregatedDefect(input);
    expect(aggregated.id).toBe("defect-001");
    expect(aggregated.count).toBe(1);
    expect(aggregated.status).toBe("open");
    expect(aggregated.category).toBe("boundary_violation");
    expect(aggregated.occurrences).toHaveLength(1);
    expect(aggregated.occurrences?.[0]?.pid).toBe(4001);
  });

  it("aggregates multiple defect occurrences and escalates severity", () => {
    const initial: DefectRecordInput = {
      id: "b-1",
      type: "test_fail",
      severity: "warning",
      category: "code_defect",
      observation: "Test timed out",
      timestamp: "2026-08-22T10:00:00.000Z",
    };

    const agg1 = toAggregatedDefect(initial);
    expect(agg1.count).toBe(1);
    expect(agg1.severity).toBe("warning");

    const incoming: DefectRecordInput = {
      type: "test_fail",
      severity: "critical",
      observation: "Test crashed with OOM",
      timestamp: "2026-08-22T10:05:00.000Z",
    };

    const agg2 = aggregateDefectEntries(agg1, incoming, { maxOccurrences: 10 });
    expect(agg2.count).toBe(2);
    expect(agg2.severity).toBe("critical");
    expect(agg2.first_seen_at).toBe("2026-08-22T10:00:00.000Z");
    expect(agg2.last_seen_at).toBe("2026-08-22T10:05:00.000Z");
    expect(agg2.occurrences).toHaveLength(2);
  });

  it("merges separate defect sets seamlessly", () => {
    const primary: AggregatedDefect[] = [
      toAggregatedDefect({
        id: "b-1",
        type: "t1",
        observation: "Obs 1",
        agent_id: "a1",
      }),
    ];

    const incoming: DefectRecordInput[] = [
      {
        id: "b-1-dup",
        type: "t1",
        observation: "Obs 1",
        agent_id: "a1",
      },
      {
        id: "b-2",
        type: "t2",
        observation: "Obs 2",
        agent_id: "a2",
      },
    ];

    const merged = mergeDefectSets(primary, incoming);
    expect(merged).toHaveLength(2);
    const first = merged.find((b) => b.type === "t1");
    expect(first?.count).toBe(2);
  });

  it("computes comprehensive defect aggregate metrics including MTTR", () => {
    const entries: AggregatedDefect[] = [
      {
        ...toAggregatedDefect({
          id: "b-1",
          type: "t1",
          category: "code_defect",
          severity: "high",
          count: 3,
          first_seen_at: "2026-08-22T10:00:00.000Z",
        }),
        status: "resolved",
        resolution: {
          task_id: "task-1",
          test_assertion: "passes",
          resolved_at: "2026-08-22T10:10:00.000Z",
        },
      },
      toAggregatedDefect({
        id: "b-2",
        type: "t2",
        category: "boundary_violation",
        severity: "critical",
        count: 1,
        status: "open",
      }),
      toAggregatedDefect({
        id: "b-3",
        type: "t3",
        category: "model_reasoning_error",
        severity: "warning",
        count: 1,
        status: "wontfix",
      }),
    ];

    const metrics = calculateDefectAggregateMetrics(entries);
    expect(metrics.total_recorded).toBe(5);
    expect(metrics.unique_defects).toBe(3);
    expect(metrics.open_count).toBe(1);
    expect(metrics.resolved_count).toBe(1);
    expect(metrics.wontfix_count).toBe(1);
    expect(metrics.recurrence_count).toBe(2);
    expect(metrics.recurrence_rate).toBeCloseTo(0.4, 2);
    expect(metrics.by_category.code_defect).toBe(1);
    expect(metrics.by_category.boundary_violation).toBe(1);
    expect(metrics.by_category.model_reasoning_error).toBe(1);
    expect(metrics.mean_time_to_resolution_ms).toBe(600_000);
  });

  it("extracts keywords and calculates Jaccard similarity accurately", () => {
    const textA = "Direct mutation on unauthorized repository write scope";
    const textB = "Unauthorized direct mutation on file system write scope";
    const textC = "Syntax error in typescript compiler parser";

    const keywords = extractDefectKeywords(textA);
    expect(keywords).toContain("direct");
    expect(keywords).toContain("mutation");
    expect(keywords).toContain("unauthorized");

    const simAB = calculateDefectSimilarity(textA, textB);
    const simAC = calculateDefectSimilarity(textA, textC);

    expect(simAB).toBeGreaterThan(0.6);
    expect(simAC).toBeLessThan(0.2);
  });

  it("clusters defects by observation semantic similarity", () => {
    const defects: AggregatedDefect[] = [
      toAggregatedDefect({
        id: "b1",
        type: "t1",
        category: "code_defect",
        observation: "Syntax error in typescript lexer token",
      }),
      toAggregatedDefect({
        id: "b2",
        type: "t1",
        category: "code_defect",
        observation: "Typescript lexer token syntax error encountered",
      }),
      toAggregatedDefect({
        id: "b3",
        type: "t2",
        category: "boundary_violation",
        observation: "Main thread unauthorized mutation",
      }),
    ];

    const clusters = clusterDefectsBySimilarity(defects, 0.5);
    expect(clusters.length).toBe(2);
    const syntaxCluster = clusters.find((c) => c.some((item) => item.id === "b1"));
    expect(syntaxCluster).toHaveLength(2);
  });
});
