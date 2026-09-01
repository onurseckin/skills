import { HarnessError } from "../../../core/errors/index.ts";
import { computeSha256 } from "../locks/index.ts";
import type {
  CognitiveChallenge,
  CompetingForce,
  CandidateResolution,
  ParetoArbitrationInput,
  ParetoArbitrationDecision,
} from "./types.ts";

export class ParetoArbitrationEngine {
  /**
   * Arbitrates a deadlocked dialectic challenge using Pareto optimization or weighted scoring
   */
  public arbitrate(
    challenge: CognitiveChallenge,
    input: ParetoArbitrationInput,
  ): ParetoArbitrationDecision {
    if (challenge.challengeId !== input.challengeId) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Challenge ID mismatch: target challenge is '${challenge.challengeId}', but input is '${input.challengeId}'.`,
      );
    }

    if (input.candidateResolutions.length === 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Pareto Arbitration requires at least one candidate resolution.",
      );
    }

    if (input.competingForces.length === 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Pareto Arbitration requires at least one competing force definition.",
      );
    }

    // Rank candidates: score * weighted sum of competing forces
    const totalForceWeight = input.competingForces.reduce((sum: number, f: CompetingForce) => sum + f.weight, 0) || 1;
    const scoredResolutions = input.candidateResolutions.map((cand: CandidateResolution) => {
      let weightedScoreSum = 0;
      for (const force of input.competingForces) {
        const forceScore = cand.forceScores[force.name] ?? 50;
        weightedScoreSum += forceScore * force.weight;
      }
      const normalizedScore = weightedScoreSum / totalForceWeight;
      return {
        ...cand,
        finalRankScore: normalizedScore,
      };
    });

    // Sort descending by final rank score
    scoredResolutions.sort(
      (a: any, b: any) =>
        b.finalRankScore - a.finalRankScore,
    );
    const winningResolution = scoredResolutions[0];
    if (!winningResolution) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Pareto Arbitration requires at least one candidate resolution.",
      );
    }

    const bindingDirectives = [
      `Binding resolution adopted: "${winningResolution.description}"`,
      `Arbitration strategy: PARETO_OPTIMAL`,
      `Trade-offs accepted: ${winningResolution.tradeOffSummary || "Equilibrium balance achieved across competing forces."}`,
      `Mandatory compliance directive: All subsequent rounds must adhere to this binding resolution.`,
    ];

    const arbitrationId = `arb-${computeSha256({ challengeId: challenge.challengeId, time: Date.now() }).slice(0, 10)}`;

    const decision: ParetoArbitrationDecision = {
      arbitrationId,
      challengeId: challenge.challengeId,
      winningResolutionId: winningResolution.resolutionId,
      winningResolutionDescription: winningResolution.description,
      compositeParetoScore: Math.round(winningResolution.finalRankScore),
      arbitratedScore: Math.min(100, Math.round(winningResolution.finalRankScore)),
      bindingDirectives,
      arbitratedAt: new Date().toISOString(),
    };

    return decision;
  }
}

/**
 * ============================================================================
 * 9. Socratic Dialectic Session Engine
 * ============================================================================
 */
