import { describe, expect, it } from "bun:test";
import {
  computeBayesFactor,
  createBayesianBelief,
  fuseEvidenceSources,
  logOddsToProbability,
  oddsToProbability,
  probabilityToLogOdds,
  probabilityToOdds,
  updateBayesianBelief,
  type BayesianEvidence,
} from "../../../../olt/scripts/src/core/epistemic/index.ts";

describe("Bayesian Belief Inference & Log-Odds Math", () => {
  it("converts between probabilities and odds reversibly", () => {
    expect(probabilityToOdds(0.5)).toBeCloseTo(1.0, 5);
    expect(oddsToProbability(1.0)).toBeCloseTo(0.5, 5);

    expect(probabilityToOdds(0.8)).toBeCloseTo(4.0, 5);
    expect(oddsToProbability(4.0)).toBeCloseTo(0.8, 5);

    expect(oddsToProbability(0)).toBe(0);
  });

  it("converts between probabilities and log-odds reversibly", () => {
    expect(probabilityToLogOdds(0.5)).toBeCloseTo(0, 5);
    expect(logOddsToProbability(0)).toBeCloseTo(0.5, 5);

    const logOddsHigh = probabilityToLogOdds(0.95);
    expect(logOddsToProbability(logOddsHigh)).toBeCloseTo(0.95, 5);

    expect(logOddsToProbability(100)).toBe(1);
    expect(logOddsToProbability(-100)).toBe(0);
  });

  it("computes Bayes factors for observed and unobserved evidence", () => {
    const supportiveEvidence: BayesianEvidence = {
      id: "ev-1",
      likelihoodGivenHypothesis: 0.9,
      likelihoodGivenNotHypothesis: 0.1,
      observed: true,
    };
    expect(computeBayesFactor(supportiveEvidence)).toBeCloseTo(9.0, 4);

    const missingEvidence: BayesianEvidence = {
      id: "ev-2",
      likelihoodGivenHypothesis: 0.9,
      likelihoodGivenNotHypothesis: 0.1,
      observed: false,
    };
    expect(computeBayesFactor(missingEvidence)).toBeCloseTo(0.1 / 0.9, 4);
  });

  it("initializes and updates Bayesian belief states monotonically", () => {
    const initial = createBayesianBelief("H1", 0.5);
    expect(initial.posteriorProbability).toBe(0.5);
    expect(initial.confidenceLevel).toBe("UNGROUNDED");

    const evidence1: BayesianEvidence = {
      id: "test-passed",
      likelihoodGivenHypothesis: 0.8,
      likelihoodGivenNotHypothesis: 0.2,
      observed: true,
    };

    const step1 = updateBayesianBelief(initial, evidence1);
    expect(step1.posteriorProbability).toBeGreaterThan(0.5);
    expect(step1.evidenceCount).toBe(1);
    expect(step1.confidenceLevel).toBe("HIGH_CONFIDENCE");

    const evidence2: BayesianEvidence = {
      id: "lint-passed",
      likelihoodGivenHypothesis: 0.9,
      likelihoodGivenNotHypothesis: 0.1,
      observed: true,
    };

    const step2 = updateBayesianBelief(step1, [evidence2, evidence2, evidence2, evidence2]);
    expect(step2.posteriorProbability).toBeGreaterThan(0.95);
    expect(step2.evidenceCount).toBe(5);
    expect(step2.confidenceLevel).toBe("CERTAIN");
    expect(step2.grade).toBe("VERY_HIGH");
  });

  it("fuses multiple evidence sources deterministically", () => {
    const evidenceBatch: BayesianEvidence[] = [
      { id: "e1", likelihoodGivenHypothesis: 0.8, likelihoodGivenNotHypothesis: 0.2, observed: true },
      { id: "e2", likelihoodGivenHypothesis: 0.7, likelihoodGivenNotHypothesis: 0.3, observed: true },
      { id: "e3", likelihoodGivenHypothesis: 0.2, likelihoodGivenNotHypothesis: 0.8, observed: false },
    ];

    const fusedProbability = fuseEvidenceSources(evidenceBatch, 0.5);
    expect(fusedProbability).toBeGreaterThan(0.85);
  });
});
