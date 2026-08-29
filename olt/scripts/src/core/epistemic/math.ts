import type {
  EpistemicConfidenceLevel,
  EpistemicGrade,
  EpistemicMetricInput,
  EpistemicScoreResult,
  EpistemicVector,
  EpistemicWeights,
  ShannonEntropyConfig,
  WilsonScoreInterval,
} from "./types.ts";
import { DEFAULT_EPISTEMIC_WEIGHTS } from "./types.ts";

export function clamp(val: number, min = 0, max = 1): number {
  if (Number.isNaN(val)) return min;
  return Math.min(Math.max(val, min), max);
}

export function calculateEpistemicGrade(score: number): EpistemicGrade {
  const normalized = clamp(score, 0, 1);
  if (normalized >= 0.9) return "VERY_HIGH";
  if (normalized >= 0.75) return "HIGH";
  if (normalized >= 0.6) return "MEDIUM";
  if (normalized >= 0.4) return "LOW";
  return "VERY_LOW";
}

export function computeWeightedEpistemicScore(
  vector: EpistemicVector,
  weights: EpistemicWeights = DEFAULT_EPISTEMIC_WEIGHTS,
): number {
  const totalWeight =
    weights.empirical +
    weights.coherence +
    weights.falsifiability +
    weights.stability +
    weights.coverage;
  if (totalWeight <= 0) return 0;

  const rawScore =
    vector.empirical * weights.empirical +
    vector.coherence * weights.coherence +
    vector.falsifiability * weights.falsifiability +
    vector.stability * weights.stability +
    vector.coverage * weights.coverage;

  return clamp(rawScore / totalWeight, 0, 1);
}

export function computeEpistemicEntropy(probabilities: readonly number[]): number {
  if (probabilities.length === 0) return 0;
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function computeShannonEntropy(
  data: Uint8Array | string | readonly number[],
  config?: ShannonEntropyConfig,
): number {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (bytes.length < (config?.minLength ?? 1)) return 0;

  const counts = new Map<number, number>();
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index]!;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const base = config?.base !== undefined && config.base > 1 ? config.base : 2;
  const logBase = Math.log(base);
  let entropy = 0;
  const total = bytes.length;

  for (const count of counts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * (Math.log(p) / logBase);
  }

  if (config?.normalize) {
    const maxDistinct = Math.min(total, counts.size > 0 ? counts.size : 1);
    const maxEntropy = maxDistinct > 1 ? Math.log(maxDistinct) / logBase : 1;
    return maxEntropy > 0 ? Math.min(1, Math.max(0, entropy / maxEntropy)) : 0;
  }
  return Math.max(0, entropy);
}

export function computeWilsonScoreInterval(
  positives: number,
  total: number,
  zScore = 1.95996,
): WilsonScoreInterval {
  if (total <= 0) return { lowerBound: 0, upperBound: 0, center: 0, zScore };

  const k = Math.max(0, Math.min(positives, total));
  const n = total;
  const z = zScore > 0 ? zScore : 1.95996;
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  const lowerBound = Math.max(0, center - margin);
  const upperBound = Math.min(1, center + margin);

  return {
    lowerBound: Number(lowerBound.toFixed(6)),
    upperBound: Number(upperBound.toFixed(6)),
    center: Number(center.toFixed(6)),
    zScore: z,
  };
}

function deriveConfidenceLevel(score: number, total: number): EpistemicConfidenceLevel {
  if (total === 0) return "UNGROUNDED";
  if (score <= 0) return "SPECULATIVE";
  if (score >= 0.82 && total >= 20) return "CERTAIN";
  if (score >= 0.75) return "HIGH_CONFIDENCE";
  if (score >= 0.5) return "MODERATE_CONFIDENCE";
  if (score >= 0.05) return "LOW_CONFIDENCE";
  return "SPECULATIVE";
}

export function computeEvidenceConfidence(input: EpistemicMetricInput): EpistemicScoreResult {
  const {
    positiveEvidenceCount,
    totalObservationCount,
    confidenceZScore,
    priorWeight = 0,
    entropyFactor = 0,
  } = input;

  const adjPositives = Math.max(0, positiveEvidenceCount + priorWeight * 0.5);
  const adjTotal = Math.max(0, totalObservationCount + priorWeight);

  const wilson = computeWilsonScoreInterval(adjPositives, adjTotal, confidenceZScore);
  const entropy = entropyFactor > 0 ? Math.min(1, Math.max(0, entropyFactor)) : 0;
  const penalizedScore = wilson.lowerBound * (1 - entropy * 0.2);
  const score = Number(Math.max(0, Math.min(1, penalizedScore)).toFixed(6));
  const confidenceLevel = deriveConfidenceLevel(score, totalObservationCount);
  const grounded = totalObservationCount > 0 && positiveEvidenceCount > 0;

  return {
    score,
    confidenceLevel,
    wilsonInterval: wilson,
    entropy,
    sampleSize: totalObservationCount,
    grounded,
  };
}
