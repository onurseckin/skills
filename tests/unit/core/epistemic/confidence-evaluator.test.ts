import { describe, expect, it } from "bun:test";
import {
  DEFAULT_EPISTEMIC_WEIGHTS,
  DEFAULT_PASS_THRESHOLD,
  calculateEpistemicGrade,
  clamp,
  computeEpistemicEntropy,
  computeEpistemicVector,
  computeEvidenceConfidence,
  computeShannonEntropy,
  computeWeightedEpistemicScore,
  computeWilsonScoreInterval,
  evaluateEpistemicConfidence,
  type EpistemicEvaluationInput,
  type EpistemicVector,
  type EpistemicWeights,
} from "../../../../olt/scripts/src/core/epistemic/index.ts";

describe("Epistemic Confidence Evaluator & Math Verification", () => {
  it("clamps numeric values into bounds", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(-0.2, 0, 1)).toBe(0);
    expect(clamp(1.5, 0, 1)).toBe(1);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });

  it("maps confidence scores to standardized epistemic grades", () => {
    expect(calculateEpistemicGrade(0.95)).toBe("VERY_HIGH");
    expect(calculateEpistemicGrade(0.90)).toBe("VERY_HIGH");
    expect(calculateEpistemicGrade(0.85)).toBe("HIGH");
    expect(calculateEpistemicGrade(0.75)).toBe("HIGH");
    expect(calculateEpistemicGrade(0.65)).toBe("MEDIUM");
    expect(calculateEpistemicGrade(0.60)).toBe("MEDIUM");
    expect(calculateEpistemicGrade(0.45)).toBe("LOW");
    expect(calculateEpistemicGrade(0.40)).toBe("LOW");
    expect(calculateEpistemicGrade(0.20)).toBe("VERY_LOW");
    expect(calculateEpistemicGrade(0)).toBe("VERY_LOW");
  });

  it("computes epistemic vectors with normalized components and contradiction penalty", () => {
    const perfectInput: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 5,
      contradictionCount: 0,
      falsifiableGateCount: 4,
      totalGateCount: 4,
      historicalStability: 1.0,
      testCoverageRatio: 1.0,
    };
    const perfectVector = computeEpistemicVector(perfectInput);
    expect(perfectVector.empirical).toBe(1);
    expect(perfectVector.coherence).toBe(1);
    expect(perfectVector.falsifiability).toBe(1);
    expect(perfectVector.stability).toBe(1);
    expect(perfectVector.coverage).toBe(1);

    const flawedInput: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 2,
      contradictionCount: 2,
      falsifiableGateCount: 1,
      totalGateCount: 4,
      historicalStability: 0.4,
      testCoverageRatio: 0.3,
    };
    const flawedVector = computeEpistemicVector(flawedInput);
    expect(flawedVector.empirical).toBeCloseTo(0.4, 5);
    expect(flawedVector.coherence).toBeCloseTo(0.3, 5);
    expect(flawedVector.falsifiability).toBeCloseTo(0.25, 5);
    expect(flawedVector.stability).toBeCloseTo(0.4, 5);
    expect(flawedVector.coverage).toBeCloseTo(0.3, 5);
  });

  it("calculates weighted epistemic score with default and custom weights", () => {
    const vector: EpistemicVector = {
      empirical: 1.0,
      coherence: 1.0,
      falsifiability: 1.0,
      stability: 1.0,
      coverage: 1.0,
    };
    expect(computeWeightedEpistemicScore(vector, DEFAULT_EPISTEMIC_WEIGHTS)).toBe(1.0);

    const zeroWeights: EpistemicWeights = {
      empirical: 0,
      coherence: 0,
      falsifiability: 0,
      stability: 0,
      coverage: 0,
    };
    expect(computeWeightedEpistemicScore(vector, zeroWeights)).toBe(0);

    const customWeights: EpistemicWeights = {
      empirical: 0.5,
      coherence: 0.5,
      falsifiability: 0,
      stability: 0,
      coverage: 0,
    };
    const mixedVector: EpistemicVector = {
      empirical: 0.8,
      coherence: 0.4,
      falsifiability: 0.2,
      stability: 0.1,
      coverage: 0.1,
    };
    expect(computeWeightedEpistemicScore(mixedVector, customWeights)).toBeCloseTo(0.6, 5);
  });

  it("evaluates epistemic confidence result and rejects on contradictions", () => {
    const passingMetrics: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 5,
      contradictionCount: 0,
      falsifiableGateCount: 4,
      totalGateCount: 4,
      historicalStability: 0.9,
      testCoverageRatio: 0.95,
    };
    const passResult = evaluateEpistemicConfidence(passingMetrics);
    expect(passResult.passed).toBe(true);
    expect(passResult.grade).toBe("VERY_HIGH");
    expect(passResult.confidenceScore).toBeGreaterThanOrEqual(DEFAULT_PASS_THRESHOLD);
    expect(passResult.reasons.length).toBeGreaterThan(0);

    const contradictoryMetrics: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 5,
      contradictionCount: 1,
      falsifiableGateCount: 4,
      totalGateCount: 4,
      historicalStability: 0.9,
      testCoverageRatio: 0.95,
    };
    const failResult = evaluateEpistemicConfidence(contradictoryMetrics);
    expect(failResult.passed).toBe(false);
    expect(failResult.reasons.some((r) => r.includes("Contradictions detected"))).toBe(true);
  });

  it("evaluates custom threshold and options", () => {
    const metrics: EpistemicEvaluationInput = {
      empiricalEvidenceCount: 3,
      contradictionCount: 0,
      falsifiableGateCount: 3,
      totalGateCount: 4,
      historicalStability: 0.8,
      testCoverageRatio: 0.8,
    };
    const strictResult = evaluateEpistemicConfidence(metrics, { threshold: 0.95 });
    expect(strictResult.passed).toBe(false);

    const lenientResult = evaluateEpistemicConfidence(metrics, 0.5);
    expect(lenientResult.passed).toBe(true);
  });

  it("computes Shannon entropy over discrete probability distributions", () => {
    expect(computeEpistemicEntropy([])).toBe(0);
    expect(computeEpistemicEntropy([1.0])).toBe(0);
    expect(computeEpistemicEntropy([0.5, 0.5])).toBe(1.0);
    expect(computeEpistemicEntropy([0.25, 0.25, 0.25, 0.25])).toBe(2.0);
  });

  it("computes Shannon entropy over string and byte sequences", () => {
    expect(computeShannonEntropy("")).toBe(0);
    expect(computeShannonEntropy("AAAAAAA")).toBe(0);

    const uniformAscii = "abcdefghijklmnopqrstuvwxyz";
    const entropyBits = computeShannonEntropy(uniformAscii);
    expect(entropyBits).toBeGreaterThan(4.5);

    const normalizedEntropy = computeShannonEntropy(uniformAscii, { normalize: true });
    expect(normalizedEntropy).toBeCloseTo(1.0, 4);

    const shortData = "abc";
    expect(computeShannonEntropy(shortData, { minLength: 10 })).toBe(0);

    const base10Entropy = computeShannonEntropy("0123456789", { base: 10, normalize: true });
    expect(base10Entropy).toBeCloseTo(1.0, 4);

    const byteData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(computeShannonEntropy(byteData)).toBe(3.0);
  });

  it("computes Wilson score intervals correctly", () => {
    const empty = computeWilsonScoreInterval(0, 0);
    expect(empty.lowerBound).toBe(0);
    expect(empty.upperBound).toBe(0);

    const perfect = computeWilsonScoreInterval(100, 100);
    expect(perfect.upperBound).toBe(1.0);
    expect(perfect.lowerBound).toBeGreaterThan(0.95);

    const moderate = computeWilsonScoreInterval(70, 100);
    expect(moderate.lowerBound).toBeGreaterThan(0.6);
    expect(moderate.upperBound).toBeLessThan(0.8);
    expect(moderate.center).toBeCloseTo(0.7, 1);
  });

  it("computes empirical evidence confidence with penalty and sample size gating", () => {
    const ungrounded = computeEvidenceConfidence({
      positiveEvidenceCount: 0,
      totalObservationCount: 0,
    });
    expect(ungrounded.confidenceLevel).toBe("UNGROUNDED");
    expect(ungrounded.grounded).toBe(false);
    expect(ungrounded.score).toBe(0);

    const solid = computeEvidenceConfidence({
      positiveEvidenceCount: 25,
      totalObservationCount: 25,
      entropyFactor: 0.1,
    });
    expect(solid.confidenceLevel).toBe("CERTAIN");
    expect(solid.grounded).toBe(true);
    expect(solid.score).toBeGreaterThan(0.8);

    const speculative = computeEvidenceConfidence({
      positiveEvidenceCount: 2,
      totalObservationCount: 10,
    });
    expect(speculative.confidenceLevel).toBe("LOW_CONFIDENCE");
    expect(speculative.grounded).toBe(true);
  });
});
