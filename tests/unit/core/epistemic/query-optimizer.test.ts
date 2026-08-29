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

describe("Epistemic Index Store", () => {
  test("stores, retrieves, and removes records", () => {
    const store = new EpistemicIndexStore();
    const r1 = createMockRecord({ id: "r1", grade: "VERY_HIGH" });
    const r2 = createMockRecord({ id: "r2", grade: "LOW", grounded: false });

    store.add(r1);
    store.add(r2);
    expect(store.size()).toBe(2);
    expect(store.get("r1")).toEqual(r1);
    expect(store.get("r2")).toEqual(r2);

    expect(store.remove("r1")).toBe(true);
    expect(store.size()).toBe(1);
    expect(store.get("r1")).toBeUndefined();
    store.clear();
    expect(store.size()).toBe(0);
  });

  test("indexes by grade, level, grounded, and tags with set intersection", () => {
    const store = new EpistemicIndexStore();
    const r1 = createMockRecord({
      id: "r1",
      grade: "VERY_HIGH",
      level: "CERTAIN",
      grounded: true,
      tags: ["t1", "t2"],
    });
    const r2 = createMockRecord({
      id: "r2",
      grade: "HIGH",
      level: "HIGH_CONFIDENCE",
      grounded: true,
      tags: ["t2"],
    });
    const r3 = createMockRecord({
      id: "r3",
      grade: "LOW",
      level: "LOW_CONFIDENCE",
      grounded: false,
      tags: ["t3"],
    });

    store.addMany([r1, r2, r3]);

    const gradeQuery = store.queryCandidates({ grades: ["VERY_HIGH", "HIGH"] });
    expect(gradeQuery.usedIndices).toContain("gradeIdx");
    expect(gradeQuery.candidateIds?.has("r1")).toBe(true);
    expect(gradeQuery.candidateIds?.has("r2")).toBe(true);
    expect(gradeQuery.candidateIds?.has("r3")).toBe(false);

    const tagQuery = store.queryCandidates({ tags: ["t2"], grounded: true });
    expect(tagQuery.usedIndices).toContain("tagIdx");
    expect(tagQuery.usedIndices).toContain("groundedIdx");
    expect(tagQuery.candidateIds?.size).toBe(2);
    expect(tagQuery.candidateIds?.has("r1")).toBe(true);
    expect(tagQuery.candidateIds?.has("r2")).toBe(true);

    const emptyCandidates = store.queryCandidates({ grades: ["VERY_LOW"] });
    expect(emptyCandidates.candidateIds?.size).toBe(0);
  });
});

describe("Epistemic Predicate Matching", () => {
  test("filters records across multiple constraints", () => {
    const r = createMockRecord({
      score: 0.78,
      grade: "HIGH",
      entropy: 0.15,
      contradictionCount: 0,
      timestamp: 1000,
      tags: ["alpha", "beta"],
    });

    expect(matchesEpistemicPredicate(r, { minConfidence: 0.7, maxConfidence: 0.8 })).toBe(true);
    expect(matchesEpistemicPredicate(r, { minConfidence: 0.85 })).toBe(false);
    expect(matchesEpistemicPredicate(r, { grades: ["HIGH", "VERY_HIGH"] })).toBe(true);
    expect(matchesEpistemicPredicate(r, { grades: ["LOW"] })).toBe(false);
    expect(matchesEpistemicPredicate(r, { minEntropy: 0.1, maxEntropy: 0.2 })).toBe(true);
    expect(matchesEpistemicPredicate(r, { minEntropy: 0.3 })).toBe(false);
    expect(matchesEpistemicPredicate(r, { createdAfter: 500, createdBefore: 1500 })).toBe(true);
    expect(matchesEpistemicPredicate(r, { contradictions: false })).toBe(true);
    expect(matchesEpistemicPredicate(r, { contradictions: true })).toBe(false);
    expect(matchesEpistemicPredicate(r, { tags: ["alpha"] })).toBe(true);
    expect(matchesEpistemicPredicate(r, { tags: ["alpha", "gamma"] })).toBe(false);
  });
});

describe("Epistemic Aggregate Computation", () => {
  test("computes distribution metrics and statistics", () => {
    const records: EpistemicRecord[] = [
      createMockRecord({ id: "1", score: 0.9, grade: "VERY_HIGH", grounded: true, entropy: 0.1 }),
      createMockRecord({ id: "2", score: 0.8, grade: "HIGH", grounded: true, entropy: 0.2 }),
      createMockRecord({ id: "3", score: 0.7, grade: "MEDIUM", grounded: false, entropy: 0.3 }),
    ];

    const agg = computeEpistemicAggregate(records);
    expect(agg.count).toBe(3);
    expect(agg.meanScore).toBeCloseTo(0.8, 4);
    expect(agg.medianScore).toBe(0.8);
    expect(agg.minScore).toBe(0.7);
    expect(agg.maxScore).toBe(0.9);
    expect(agg.groundedCount).toBe(2);
    expect(agg.meanEntropy).toBeCloseTo(0.2, 4);
    expect(agg.gradeDistribution.VERY_HIGH).toBe(1);
    expect(agg.gradeDistribution.HIGH).toBe(1);
    expect(agg.gradeDistribution.MEDIUM).toBe(1);
  });

  test("handles empty record set safely", () => {
    const emptyAgg = computeEpistemicAggregate([]);
    expect(emptyAgg.count).toBe(0);
    expect(emptyAgg.meanScore).toBe(0);
    expect(emptyAgg.groundedCount).toBe(0);
  });
});

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

  test("supports projection modes and memoized query plan caching", () => {
    const records = [
      createMockRecord({ id: "r1", score: 0.95, grade: "VERY_HIGH" }),
      createMockRecord({ id: "r2", score: 0.85, grade: "HIGH" }),
    ];

    const optimizer = new EpistemicQueryOptimizer();
    const query: EpistemicQuery = {
      where: { minConfidence: 0.8 },
      projection: "score_only",
    };

    const res1 = optimizer.execute(query, records);
    expect(res1.records.length).toBe(2);
    expect((res1.records[0] as unknown as { score: number }).score).toBe(0.95);
    expect((res1.records[0] as unknown as { vector?: unknown }).vector).toBeUndefined();

    const plan2 = optimizer.plan(query);
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
