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
  it("converts between probabilities and odds reversibly with boundaries", () => {
    expect(probabilityToOdds(0.5)).toBeCloseTo(1.0, 5);
    expect(oddsToProbability(1.0)).toBeCloseTo(0.5, 5);

    expect(probabilityToOdds(0.8)).toBeCloseTo(4.0, 5);
    expect(oddsToProbability(4.0)).toBeCloseTo(0.8, 5);

    expect(oddsToProbability(0)).toBe(0);
    expect(oddsToProbability(-5)).toBe(0);
    expect(oddsToProbability(Infinity)).toBe(1);

    expect(probabilityToOdds(0)).toBeCloseTo(0.0001 / 0.9999, 4);
    expect(probabilityToOdds(1)).toBeCloseTo(0.9999 / 0.0001, 4);
  });

  it("converts between probabilities and log-odds reversibly with boundaries", () => {
    expect(probabilityToLogOdds(0.5)).toBeCloseTo(0, 5);
    expect(logOddsToProbability(0)).toBeCloseTo(0.5, 5);

    const logOddsHigh = probabilityToLogOdds(0.95);
    expect(logOddsToProbability(logOddsHigh)).toBeCloseTo(0.95, 5);

    expect(logOddsToProbability(100)).toBe(1);
    expect(logOddsToProbability(31)).toBe(1);
    expect(logOddsToProbability(-100)).toBe(0);
    expect(logOddsToProbability(-31)).toBe(0);

    expect(probabilityToLogOdds(0)).toBeLessThan(-10);
    expect(probabilityToLogOdds(1)).toBeGreaterThan(10);
  });

  it("computes Bayes factors for observed and unobserved evidence with weights", () => {
    const supportiveEvidence: BayesianEvidence = {
      id: "ev-1",
      likelihoodGivenHypothesis: 0.9,
      likelihoodGivenNotHypothesis: 0.1,
      observed: true,
      weight: 1.5,
    };
    expect(computeBayesFactor(supportiveEvidence)).toBeCloseTo(Math.pow(9.0, 1.5), 4);

    const missingEvidence: BayesianEvidence = {
      id: "ev-2",
      likelihoodGivenHypothesis: 0.9,
      likelihoodGivenNotHypothesis: 0.1,
      observed: false,
      weight: 0.5,
    };
    expect(computeBayesFactor(missingEvidence)).toBeCloseTo(Math.pow(0.1 / 0.9, 0.5), 4);

    // Default weight (1.0)
    const unweighted: BayesianEvidence = {
      id: "ev-3",
      likelihoodGivenHypothesis: 0.8,
      likelihoodGivenNotHypothesis: 0.2,
      observed: true,
    };
    expect(computeBayesFactor(unweighted)).toBeCloseTo(4.0, 4);

    const unweightedUnobserved: BayesianEvidence = {
      id: "ev-4",
      likelihoodGivenHypothesis: 0.8,
      likelihoodGivenNotHypothesis: 0.2,
      observed: false,
    };
    expect(computeBayesFactor(unweightedUnobserved)).toBeCloseTo(0.2 / 0.8, 4);
  });

  it("initializes and updates Bayesian belief states monotonically and exercises all confidence tiers", () => {
    const initial = createBayesianBelief("H1", 0.5);
    expect(initial.posteriorProbability).toBe(0.5);
    expect(initial.confidenceLevel).toBe("UNGROUNDED");

    // Empty evidence returns current
    expect(updateBayesianBelief(initial, [])).toEqual(initial);

    // Moderate confidence tier (posterior in [0.5, 0.8))
    const weakSupportive: BayesianEvidence = {
      id: "weak-ev",
      likelihoodGivenHypothesis: 0.6,
      likelihoodGivenNotHypothesis: 0.4,
      observed: true,
    };
    const modStep = updateBayesianBelief(initial, weakSupportive);
    expect(modStep.confidenceLevel).toBe("MODERATE_CONFIDENCE");
    expect(modStep.evidenceCount).toBe(1);

    // Low confidence tier (posterior in [0.2, 0.5))
    const weakRefuting: BayesianEvidence = {
      id: "weak-ref",
      likelihoodGivenHypothesis: 0.3,
      likelihoodGivenNotHypothesis: 0.7,
      observed: true,
    };
    const lowStep = updateBayesianBelief(initial, weakRefuting);
    expect(lowStep.confidenceLevel).toBe("LOW_CONFIDENCE");

    // Speculative tier (posterior < 0.2)
    const strongRefuting: BayesianEvidence = {
      id: "strong-ref",
      likelihoodGivenHypothesis: 0.05,
      likelihoodGivenNotHypothesis: 0.95,
      observed: true,
    };
    const specStep = updateBayesianBelief(initial, [strongRefuting, strongRefuting]);
    expect(specStep.confidenceLevel).toBe("SPECULATIVE");

    // High confidence tier (posterior in [0.8, 0.95) or count < 5)
    const evidence1: BayesianEvidence = {
      id: "test-passed",
      likelihoodGivenHypothesis: 0.85,
      likelihoodGivenNotHypothesis: 0.15,
      observed: true,
    };
    const highStep = updateBayesianBelief(initial, evidence1);
    expect(highStep.posteriorProbability).toBeGreaterThan(0.8);
    expect(highStep.evidenceCount).toBe(1);
    expect(highStep.confidenceLevel).toBe("HIGH_CONFIDENCE");

    // Certain tier (posterior >= 0.95 and evidenceCount >= 5)
    const evidence2: BayesianEvidence = {
      id: "lint-passed",
      likelihoodGivenHypothesis: 0.9,
      likelihoodGivenNotHypothesis: 0.1,
      observed: true,
    };
    const certainStep = updateBayesianBelief(highStep, [evidence2, evidence2, evidence2, evidence2]);
    expect(certainStep.posteriorProbability).toBeGreaterThan(0.95);
    expect(certainStep.evidenceCount).toBe(5);
    expect(certainStep.confidenceLevel).toBe("CERTAIN");
    expect(certainStep.grade).toBe("VERY_HIGH");
  });

  it("fuses multiple evidence sources deterministically with defaults and priors", () => {
    const evidenceBatch: BayesianEvidence[] = [
      {
        id: "e1",
        likelihoodGivenHypothesis: 0.8,
        likelihoodGivenNotHypothesis: 0.2,
        observed: true,
      },
      {
        id: "e2",
        likelihoodGivenHypothesis: 0.7,
        likelihoodGivenNotHypothesis: 0.3,
        observed: true,
      },
      {
        id: "e3",
        likelihoodGivenHypothesis: 0.2,
        likelihoodGivenNotHypothesis: 0.8,
        observed: false,
      },
    ];

    const fusedProbability = fuseEvidenceSources(evidenceBatch, 0.5);
    expect(fusedProbability).toBeGreaterThan(0.85);

    // Empty evidence returns initial prior
    expect(fuseEvidenceSources([], 0.6)).toBeCloseTo(0.6, 4);
    expect(fuseEvidenceSources([])).toBeCloseTo(0.5, 4);
  });
});
