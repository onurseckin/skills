import { calculateEpistemicGrade, clamp } from "./math.ts";
import type {
  BayesianBeliefState,
  BayesianEvidence,
  BayesianUpdateOptions,
  EpistemicConfidenceLevel,
} from "./types.ts";

export function probabilityToOdds(p: number): number {
  const boundedP = clamp(p, 0.0001, 0.9999);
  return boundedP / (1 - boundedP);
}

export function oddsToProbability(odds: number): number {
  if (odds <= 0) return 0;
  if (!Number.isFinite(odds)) return 1;
  return odds / (1 + odds);
}

export function probabilityToLogOdds(p: number): number {
  const boundedP = clamp(p, 0.000001, 0.999999);
  return Math.log(boundedP / (1 - boundedP));
}

export function logOddsToProbability(logOdds: number): number {
  if (logOdds > 30) return 1;
  if (logOdds < -30) return 0;
  return 1 / (1 + Math.exp(-logOdds));
}

export function computeBayesFactor(evidence: BayesianEvidence): number {
  const pEGivenH = clamp(evidence.likelihoodGivenHypothesis, 0.0001, 0.9999);
  const pEGivenNotH = clamp(evidence.likelihoodGivenNotHypothesis, 0.0001, 0.9999);

  if (evidence.observed) {
    const rawFactor = pEGivenH / pEGivenNotH;
    const weight = evidence.weight !== undefined ? clamp(evidence.weight, 0, 2) : 1.0;
    return Math.pow(rawFactor, weight);
  }

  const pNotEGivenH = 1 - pEGivenH;
  const pNotEGivenNotH = 1 - pEGivenNotH;
  const rawFactor = pNotEGivenH / pNotEGivenNotH;
  const weight = evidence.weight !== undefined ? clamp(evidence.weight, 0, 2) : 1.0;
  return Math.pow(rawFactor, weight);
}

function deriveBayesianConfidenceLevel(
  posterior: number,
  evidenceCount: number,
): EpistemicConfidenceLevel {
  if (evidenceCount === 0) return "UNGROUNDED";
  if (posterior >= 0.95 && evidenceCount >= 5) return "CERTAIN";
  if (posterior >= 0.8) return "HIGH_CONFIDENCE";
  if (posterior >= 0.5) return "MODERATE_CONFIDENCE";
  if (posterior >= 0.2) return "LOW_CONFIDENCE";
  return "SPECULATIVE";
}

export function createBayesianBelief(
  hypothesisId: string,
  initialPrior = 0.5,
): BayesianBeliefState {
  const prior = clamp(initialPrior, 0.01, 0.99);
  const logOdds = probabilityToLogOdds(prior);
  const grade = calculateEpistemicGrade(prior);
  const confidenceLevel = deriveBayesianConfidenceLevel(prior, 0);

  return {
    hypothesisId,
    priorProbability: prior,
    posteriorProbability: prior,
    logOdds,
    evidenceCount: 0,
    grade,
    confidenceLevel,
    updatedAt: Date.now(),
  };
}

export function updateBayesianBelief(
  current: BayesianBeliefState,
  evidence: BayesianEvidence | readonly BayesianEvidence[],
  _options: BayesianUpdateOptions = {},
): BayesianBeliefState {
  const evidenceList = Array.isArray(evidence) ? evidence : [evidence];
  if (evidenceList.length === 0) return current;

  let currentLogOdds = current.logOdds;
  let addedEvidenceCount = 0;

  for (const item of evidenceList) {
    const factor = computeBayesFactor(item);
    if (factor > 0 && Number.isFinite(factor)) {
      currentLogOdds += Math.log(factor);
      addedEvidenceCount += 1;
    }
  }

  const posterior = clamp(logOddsToProbability(currentLogOdds), 0, 1);
  const totalCount = current.evidenceCount + addedEvidenceCount;
  const grade = calculateEpistemicGrade(posterior);
  const confidenceLevel = deriveBayesianConfidenceLevel(posterior, totalCount);

  return {
    hypothesisId: current.hypothesisId,
    priorProbability: current.posteriorProbability,
    posteriorProbability: posterior,
    logOdds: currentLogOdds,
    evidenceCount: totalCount,
    grade,
    confidenceLevel,
    updatedAt: Date.now(),
  };
}

export function fuseEvidenceSources(
  pieces: readonly BayesianEvidence[],
  initialPrior = 0.5,
): number {
  let logOdds = probabilityToLogOdds(clamp(initialPrior, 0.01, 0.99));
  for (const piece of pieces) {
    const factor = computeBayesFactor(piece);
    if (factor > 0 && Number.isFinite(factor)) {
      logOdds += Math.log(factor);
    }
  }
  return clamp(logOddsToProbability(logOdds), 0, 1);
}
