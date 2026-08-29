import { describe, expect, test } from "bun:test";
import {
  computeEvidenceConfidence,
  computeShannonEntropy,
  computeWilsonScoreInterval,
} from "../../../../olt/scripts/src/core/epistemic/index.ts";

describe("Shannon Information Entropy Math", () => {
  test("returns 0 for empty data or below minimum length", () => {
    expect(computeShannonEntropy(new Uint8Array([]))).toBe(0);
    expect(computeShannonEntropy("")).toBe(0);
    expect(computeShannonEntropy("abc", { minLength: 5 })).toBe(0);
  });

  test("returns 0 for homogeneous uniform data with zero uncertainty", () => {
    expect(computeShannonEntropy("aaaaaa")).toBe(0);
    expect(computeShannonEntropy(new Uint8Array([7, 7, 7, 7]))).toBe(0);
    expect(computeShannonEntropy([42, 42, 42])).toBe(0);
  });

  test("computes exact Shannon entropy in bits for uniform distributions", () => {
    const twoSymbols = new Uint8Array([0, 1]);
    expect(computeShannonEntropy(twoSymbols)).toBeCloseTo(1.0, 5);

    const fourSymbols = new Uint8Array([1, 2, 3, 4]);
    expect(computeShannonEntropy(fourSymbols)).toBeCloseTo(2.0, 5);

    const eightSymbols = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(computeShannonEntropy(eightSymbols)).toBeCloseTo(3.0, 5);
  });

  test("supports logarithmic base configuration", () => {
    const data = "abcdefgh";
    const bitsEntropy = computeShannonEntropy(data, { base: 2 });
    const natsEntropy = computeShannonEntropy(data, { base: Math.E });
    const ditsEntropy = computeShannonEntropy(data, { base: 10 });

    expect(bitsEntropy).toBeCloseTo(3.0, 5);
    expect(natsEntropy).toBeCloseTo(Math.log(8), 5);
    expect(ditsEntropy).toBeCloseTo(Math.log10(8), 5);
  });

  test("computes normalized entropy bounded between 0 and 1", () => {
    const uniform = "abcdefghijklmnop";
    const normalizedUniform = computeShannonEntropy(uniform, { normalize: true });
    expect(normalizedUniform).toBeCloseTo(1.0, 5);

    const biased = "aaaaaaaaaaaaaaab";
    const normalizedBiased = computeShannonEntropy(biased, { normalize: true });
    expect(normalizedBiased).toBeGreaterThan(0);
    expect(normalizedBiased).toBeLessThan(0.5);
  });
});

describe("Wilson Score Interval Math", () => {
  test("returns zeroed bounds for zero or negative trials", () => {
    const zeroTrials = computeWilsonScoreInterval(0, 0);
    expect(zeroTrials.lowerBound).toBe(0);
    expect(zeroTrials.upperBound).toBe(0);
    expect(zeroTrials.center).toBe(0);

    const negativeTrials = computeWilsonScoreInterval(5, -10);
    expect(negativeTrials.lowerBound).toBe(0);
  });

  test("computes asymmetric confidence interval for zero successes", () => {
    const interval = computeWilsonScoreInterval(0, 20);
    expect(interval.lowerBound).toBe(0);
    expect(interval.center).toBeGreaterThan(0);
    expect(interval.upperBound).toBeGreaterThan(0);
    expect(interval.upperBound).toBeLessThan(0.2);
  });

  test("computes asymmetric confidence interval for 100% successes", () => {
    const interval = computeWilsonScoreInterval(20, 20);
    expect(interval.upperBound).toBe(1.0);
    expect(interval.center).toBeLessThan(1.0);
    expect(interval.lowerBound).toBeGreaterThan(0.8);
  });

  test("narrows interval width monotonically as sample size increases", () => {
    const smallSample = computeWilsonScoreInterval(8, 10);
    const largeSample = computeWilsonScoreInterval(800, 1000);

    const smallWidth = smallSample.upperBound - smallSample.lowerBound;
    const largeWidth = largeSample.upperBound - largeSample.lowerBound;

    expect(largeWidth).toBeLessThan(smallWidth);
    expect(largeSample.lowerBound).toBeGreaterThan(smallSample.lowerBound);
  });

  test("respects custom z-score significance levels", () => {
    const interval95 = computeWilsonScoreInterval(45, 50, 1.95996);
    const interval99 = computeWilsonScoreInterval(45, 50, 2.57583);

    const width95 = interval95.upperBound - interval95.lowerBound;
    const width99 = interval99.upperBound - interval99.lowerBound;

    expect(width99).toBeGreaterThan(width95);
    expect(interval99.lowerBound).toBeLessThanOrEqual(interval95.lowerBound);
  });
});

describe("Epistemic Evidence Confidence Scoring", () => {
  test("evaluates ungrounded metrics with 0 observations", () => {
    const result = computeEvidenceConfidence({
      positiveEvidenceCount: 0,
      totalObservationCount: 0,
    });

    expect(result.score).toBe(0);
    expect(result.confidenceLevel).toBe("UNGROUNDED");
    expect(result.grounded).toBe(false);
    expect(result.sampleSize).toBe(0);
  });

  test("evaluates high-volume perfect evidence as CERTAIN", () => {
    const result = computeEvidenceConfidence({
      positiveEvidenceCount: 100,
      totalObservationCount: 100,
    });

    expect(result.score).toBeGreaterThanOrEqual(0.95);
    expect(result.confidenceLevel).toBe("CERTAIN");
    expect(result.grounded).toBe(true);
    expect(result.sampleSize).toBe(100);
  });

  test("evaluates solid positive track record as HIGH_CONFIDENCE", () => {
    const result = computeEvidenceConfidence({
      positiveEvidenceCount: 45,
      totalObservationCount: 50,
    });

    expect(result.score).toBeGreaterThan(0.75);
    expect(result.confidenceLevel).toBe("HIGH_CONFIDENCE");
    expect(result.grounded).toBe(true);
  });

  test("evaluates sparse or mixed observations with lower confidence tiers", () => {
    const moderate = computeEvidenceConfidence({
      positiveEvidenceCount: 15,
      totalObservationCount: 20,
    });
    expect(["MODERATE_CONFIDENCE", "LOW_CONFIDENCE", "HIGH_CONFIDENCE"]).toContain(
      moderate.confidenceLevel,
    );

    const low = computeEvidenceConfidence({
      positiveEvidenceCount: 2,
      totalObservationCount: 5,
    });
    expect(["LOW_CONFIDENCE", "SPECULATIVE"]).toContain(low.confidenceLevel);
  });

  test("applies Bayesian prior weight and entropy penalty appropriately", () => {
    const rawResult = computeEvidenceConfidence({
      positiveEvidenceCount: 5,
      totalObservationCount: 5,
      entropyFactor: 0,
    });

    const penalizedResult = computeEvidenceConfidence({
      positiveEvidenceCount: 5,
      totalObservationCount: 5,
      entropyFactor: 0.8,
    });

    expect(penalizedResult.score).toBeLessThan(rawResult.score);
    expect(penalizedResult.entropy).toBe(0.8);
  });
});
