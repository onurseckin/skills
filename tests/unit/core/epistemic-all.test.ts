import { describe, expect, it } from "bun:test";
import {
  evaluateEpistemicConfidence,
  computeEpistemicVector,
  computeWeightedEpistemicScore,
  calculateEpistemicGrade,
} from "../../../olt/scripts/src/core/epistemic/evaluator.ts";
import {
  matchesEpistemicPredicate,
  computeEpistemicAggregate,
} from "../../../olt/scripts/src/core/epistemic/predicate.ts";
import {
  EpistemicEventBus,
  EpistemicEventStream,
} from "../../../olt/scripts/src/core/epistemic/streaming.ts";
import {
  createBayesianBelief,
  updateBayesianBelief,
  fuseEvidenceSources,
} from "../../../olt/scripts/src/core/epistemic/bayesian-inference.ts";
import type { EpistemicRecord } from "../../../olt/scripts/src/core/epistemic/types.ts";

describe("core/epistemic evaluator edge cases", () => {
  it("generates failure reasons for insufficient evidence, low falsifiability, stability, and coverage", () => {
    const result = evaluateEpistemicConfidence(
      {
        empiricalEvidenceCount: 1,
        contradictionCount: 2,
        falsifiableGateCount: 1,
        totalGateCount: 5,
        historicalStability: 0.3,
        testCoverageRatio: 0.2,
      },
      0.9, // high threshold
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    expect(result.reasons.some((r) => r.includes("empirical evidence count"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("Contradictions detected"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("proportion of falsifiable gates"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("stability"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("Test coverage ratio"))).toBe(true);

    const zeroGates = evaluateEpistemicConfidence(
      {
        empiricalEvidenceCount: 5,
        contradictionCount: 0,
        falsifiableGateCount: 0,
        totalGateCount: 0,
        historicalStability: 0.9,
        testCoverageRatio: 1.0,
      },
      0.5,
    );
    expect(zeroGates.reasons.some((r) => r.includes("Zero falsifiable evidence gates"))).toBe(true);
  });
});

describe("core/epistemic predicate edge cases", () => {
  it("matchesEpistemicPredicate handles contradiction ranges and tag matching", () => {
    const rec: EpistemicRecord = {
      id: "rec-1",
      topic: "testing",
      score: 0.85,
      grade: "HIGH",
      level: "HIGH_CONFIDENCE",
      grounded: true,
      entropy: 0.3,
      contradictionCount: 2,
      tags: ["unit", "core"],
      timestamp: 1000,
    };

    expect(matchesEpistemicPredicate(rec, { contradictions: { min: 1, max: 3 } })).toBe(true);
    expect(matchesEpistemicPredicate(rec, { contradictions: { min: 3 } })).toBe(false);
    expect(matchesEpistemicPredicate(rec, { contradictions: { max: 1 } })).toBe(false);
    expect(matchesEpistemicPredicate(rec, { createdAfter: 500, createdBefore: 1500 })).toBe(true);
    expect(matchesEpistemicPredicate(rec, { createdAfter: 2000 })).toBe(false);
    expect(matchesEpistemicPredicate(rec, { createdBefore: 500 })).toBe(false);
  });

  it("computeEpistemicAggregate handles empty and populated records", () => {
    const empty = computeEpistemicAggregate([]);
    expect(empty.count).toBe(0);
    expect(empty.meanScore).toBe(0);

    const single: EpistemicRecord = {
      id: "rec-1",
      topic: "test",
      score: 0.8,
      grade: "HIGH",
      level: "HIGH_CONFIDENCE",
      grounded: true,
      entropy: 0.2,
      contradictionCount: 0,
      tags: [],
      timestamp: 1000,
    };
    const agg = computeEpistemicAggregate([single]);
    expect(agg.count).toBe(1);
    expect(agg.meanScore).toBe(0.8);
    expect(agg.groundedCount).toBe(1);
  });
});

describe("core/epistemic streaming edge cases", () => {
  it("supports debounce, throttle, sample, and bus methods", async () => {
    const bus = new EpistemicEventBus(50);
    const journal = bus.getJournal();
    expect(journal).toBeDefined();

    const stream = bus.stream("claim:registered");
    expect(stream).toBeDefined();
    const allStream = bus.stream("*");
    expect(allStream).toBeDefined();

    // Replay
    expect(bus.replay()).toEqual([]);

    bus.clear();
    bus.close();

    // Stream debounce
    const testStream = new EpistemicEventStream<number>();
    const debounced = testStream.debounce(10);
    let debouncedVal: number | null = null;
    debounced.subscribe((val) => {
      debouncedVal = val;
    });
    testStream.emit(1);
    testStream.emit(2);
    await new Promise((r) => setTimeout(r, 25));
    expect(debouncedVal).toBe(2);

    // Stream throttle
    const throttled = testStream.throttle(10);
    const throttledVals: number[] = [];
    throttled.subscribe((val) => throttledVals.push(val));
    testStream.emit(10);
    testStream.emit(20);
    expect(throttledVals).toContain(10);

    // Stream sample
    const sampled = testStream.sample(20);
    let sampledVal: number | null = null;
    sampled.subscribe((val) => {
      sampledVal = val;
    });
    testStream.emit(99);
    await new Promise((r) => setTimeout(r, 40));
    expect(sampledVal).toBe(99);
  });
});

describe("core/epistemic bayesian inference levels", () => {
  it("derives all bayesian confidence levels correctly", () => {
    const belief = createBayesianBelief("hyp-1", 0.5);
    expect(belief.confidenceLevel).toBe("UNGROUNDED");

    // Multiple positive evidences to reach high / certain
    let current = belief;
    for (let i = 0; i < 6; i++) {
      current = updateBayesianBelief(current, {
        id: `ev-${i}`,
        evidenceId: `ev-${i}`,
        hypothesisId: "hyp-1",
        name: "test",
        type: "EMPIRICAL",
        observed: true,
        likelihoodGivenHypothesis: 0.9,
        likelihoodGivenNotHypothesis: 0.1,
        weight: 1.0,
      });
    }
    expect(current.confidenceLevel).toBe("CERTAIN");

    // Moderate / low confidence scenarios
    const fused = fuseEvidenceSources(
      [
        {
          id: "ev-1",
          evidenceId: "ev-1",
          hypothesisId: "hyp-1",
          name: "test",
          type: "EMPIRICAL",
          observed: true,
          likelihoodGivenHypothesis: 0.55,
          likelihoodGivenNotHypothesis: 0.45,
          weight: 1.0,
        },
      ],
      0.6,
    );
    expect(fused).toBeGreaterThan(0.5);
  });
});
