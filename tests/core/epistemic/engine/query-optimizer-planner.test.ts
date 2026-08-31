import { describe, expect, test } from "bun:test";
import {
  computeEpistemicAggregate,
  EpistemicIndexStore,
  EpistemicQueryOptimizer,
  matchesEpistemicPredicate,
  type EpistemicQuery,
  type EpistemicRecord,
} from "../../../../olt/scripts/src/core/epistemic/index.ts";

function createMockRecord(partial: Partial<EpistemicRecord> = {}): EpistemicRecord {
  return {
    id: partial.id ?? "rec-1",
    timestamp: partial.timestamp ?? 1700000000000,
    score: partial.score ?? 0.85,
    grade: partial.grade ?? "HIGH",
    level: partial.level ?? "HIGH_CONFIDENCE",
    grounded: partial.grounded ?? true,
    vector: partial.vector ?? {
      empirical: 0.8,
      coherence: 1,
      falsifiability: 0.9,
      stability: 0.9,
      coverage: 0.8,
    },
    entropy: partial.entropy ?? 0.2,
    contradictionCount: partial.contradictionCount ?? 0,
    tags: partial.tags ?? ["unit-test", "core"],
    metadata: partial.metadata,
  };
}

describe("Epistemic Query Optimizer & Execution", () => {
  test("plans and executes index-accelerated query", () => {
    const store = new EpistemicIndexStore();
    for (let i = 0; i < 20; i++) {
      store.add(
        createMockRecord({
          id: `rec-${i}`,
          score: i / 20,
          grade: i > 15 ? "VERY_HIGH" : i > 10 ? "HIGH" : "LOW",
          tags: [i % 2 === 0 ? "even" : "odd"],
        }),
      );
    }

    const optimizer = new EpistemicQueryOptimizer();
    const query: EpistemicQuery = {
      where: { grades: ["VERY_HIGH"] },
      orderBy: [{ field: "confidence", direction: "desc" }],
      limit: 3,
      includeAggregate: true,
    };

    const result = optimizer.execute(query, store);
    expect(result.plan.executionStrategy).toBe("INDEX_SCAN");
    expect(result.plan.usedIndices).toContain("gradeIdx");
    expect(result.records.length).toBe(3);
    expect(result.totalMatched).toBe(4);
    expect(result.aggregate).toBeDefined();
    expect(result.aggregate?.count).toBe(4);
  });

  test("supports all orderBy sort fields, directions, tie-breaking, and pagination offset", () => {
    const records = [
      createMockRecord({
        id: "r1",
        score: 0.9,
        entropy: 0.1,
        contradictionCount: 0,
        timestamp: 1000,
        grade: "VERY_HIGH",
      }),
      createMockRecord({
        id: "r2",
        score: 0.5,
        entropy: 0.4,
        contradictionCount: 3,
        timestamp: 2000,
        grade: "MEDIUM",
      }),
      createMockRecord({
        id: "r3",
        score: 0.7,
        entropy: 0.2,
        contradictionCount: 1,
        timestamp: 1500,
        grade: "HIGH",
      }),
      createMockRecord({
        id: "r4",
        score: 0.7,
        entropy: 0.2,
        contradictionCount: 1,
        timestamp: 1500,
        grade: "HIGH",
      }),
    ];

    const optimizer = new EpistemicQueryOptimizer();

    // Sort by entropy asc
    const entropyRes = optimizer.execute(
      { orderBy: [{ field: "entropy", direction: "asc" }] },
      records,
    );
    expect((entropyRes.records[0] as unknown as EpistemicRecord).id).toBe("r1");

    // Sort by contradictions desc
    const contraRes = optimizer.execute(
      { orderBy: [{ field: "contradictions", direction: "desc" }] },
      records,
    );
    expect((contraRes.records[0] as unknown as EpistemicRecord).id).toBe("r2");

    // Sort by timestamp asc with offset
    const timeRes = optimizer.execute(
      { orderBy: [{ field: "timestamp", direction: "asc" }], offset: 1, limit: 2 },
      records,
    );
    expect(timeRes.records.length).toBe(2);

    // Sort by grade desc
    const gradeRes = optimizer.execute(
      {
        orderBy: [
          { field: "grade", direction: "desc" },
          { field: "timestamp", direction: "desc" },
        ],
      },
      records,
    );
    expect((gradeRes.records[0] as unknown as EpistemicRecord).grade).toBe("VERY_HIGH");
  });

  test("supports projection modes and memoized query plan caching", () => {
    const records = [
      createMockRecord({ id: "r1", score: 0.95, grade: "VERY_HIGH" }),
      createMockRecord({ id: "r2", score: 0.85, grade: "HIGH" }),
    ];

    const optimizer = new EpistemicQueryOptimizer();

    // Score only projection
    const queryScore: EpistemicQuery = {
      where: { minConfidence: 0.8 },
      projection: "score_only",
    };
    const resScore = optimizer.execute(queryScore, records);
    expect(resScore.records.length).toBe(2);
    expect((resScore.records[0] as unknown as { score: number }).score).toBe(0.95);
    expect((resScore.records[0] as unknown as { vector?: unknown }).vector).toBeUndefined();

    // Vector projection
    const queryVec: EpistemicQuery = { projection: "vector" };
    const resVec = optimizer.execute(queryVec, records);
    expect((resVec.records[0] as unknown as { vector: unknown }).vector).toBeDefined();

    // Standard default projection
    const queryStd: EpistemicQuery = { projection: "standard" };
    const resStd = optimizer.execute(queryStd, records);
    expect((resStd.records[0] as unknown as EpistemicRecord).id).toBe("r1");

    // Full projection
    const queryFull: EpistemicQuery = { projection: "full" };
    const resFull = optimizer.execute(queryFull, records);
    expect((resFull.records[0] as unknown as EpistemicRecord).vector).toBeDefined();

    // Memoized cache hit
    const plan2 = optimizer.plan(queryScore);
    expect(plan2.cacheHit).toBe(true);
  });

  test("handles empty match plan cleanly", () => {
    const store = new EpistemicIndexStore();
    store.add(createMockRecord({ id: "r1", grade: "HIGH" }));

    const optimizer = new EpistemicQueryOptimizer();
    const query: EpistemicQuery = { where: { grades: ["VERY_LOW"] } };
    const result = optimizer.execute(query, store);

    expect(result.plan.executionStrategy).toBe("EMPTY_MATCH");
    expect(result.records.length).toBe(0);
    expect(result.totalMatched).toBe(0);
  });
});
