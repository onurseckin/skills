import {
  calculateEpistemicGrade,
  clamp,
  computeWeightedEpistemicScore,
} from "./math.ts";
import {
  DEFAULT_EPISTEMIC_WEIGHTS,
  DEFAULT_PASS_THRESHOLD,
  type EpistemicConfidenceResult,
  type EpistemicEvaluationInput,
  type EpistemicVector,
  type EpistemicWeights,
} from "./types.ts";

export interface EvaluateEpistemicOptions {
  readonly weights?: EpistemicWeights | undefined;
  readonly threshold?: number | undefined;
}

export function computeEpistemicVector(
  metrics: EpistemicEvaluationInput | Record<string, unknown>,
): EpistemicVector {
  const empiricalCount =
    typeof metrics.empiricalEvidenceCount === "number"
      ? metrics.empiricalEvidenceCount
      : 0;
  const empirical = clamp(empiricalCount / 5, 0, 1);

  const contradictionCount =
    typeof metrics.contradictionCount === "number"
      ? metrics.contradictionCount
      : 0;
  const coherence =
    contradictionCount === 0 ? 1 : clamp(1 - contradictionCount * 0.35, 0, 1);

  const falsifiable =
    typeof metrics.falsifiableGateCount === "number"
      ? metrics.falsifiableGateCount
      : 0;
  const totalGates =
    typeof metrics.totalGateCount === "number" ? metrics.totalGateCount : 0;
  const falsifiability =
    totalGates > 0 ? clamp(falsifiable / totalGates, 0, 1) : 0;

  const stability =
    typeof metrics.historicalStability === "number"
      ? clamp(metrics.historicalStability, 0, 1)
      : 0.5;

  const coverage =
    typeof metrics.testCoverageRatio === "number"
      ? clamp(metrics.testCoverageRatio, 0, 1)
      : 0.5;

  return {
    empirical,
    coherence,
    falsifiability,
    stability,
    coverage,
  };
}

export function evaluateEpistemicConfidence(
  metrics: EpistemicEvaluationInput | Record<string, unknown>,
  options?: EvaluateEpistemicOptions | number,
): EpistemicConfidenceResult {
  const optObj = typeof options === "number" ? { threshold: options } : options ?? {};
  const weights = optObj.weights ?? DEFAULT_EPISTEMIC_WEIGHTS;
  const threshold = optObj.threshold ?? DEFAULT_PASS_THRESHOLD;

  const contradictionCount =
    typeof metrics.contradictionCount === "number"
      ? metrics.contradictionCount
      : 0;

  const vector = computeEpistemicVector(metrics);
  const confidenceScore = computeWeightedEpistemicScore(vector, weights);
  const grade = calculateEpistemicGrade(confidenceScore);
  const passed = confidenceScore >= threshold && contradictionCount === 0;

  const reasons: string[] = [];

  const empiricalCount =
    typeof metrics.empiricalEvidenceCount === "number"
      ? metrics.empiricalEvidenceCount
      : 0;
  if (vector.empirical < 0.6) {
    reasons.push(
      `Insufficient empirical evidence count (${empiricalCount} observed, target >= 3)`,
    );
  }

  if (contradictionCount > 0) {
    reasons.push(
      `Contradictions detected in claim set (${contradictionCount} contradiction${contradictionCount === 1 ? "" : "s"})`,
    );
  }

  const falsifiable =
    typeof metrics.falsifiableGateCount === "number"
      ? metrics.falsifiableGateCount
      : 0;
  const totalGates =
    typeof metrics.totalGateCount === "number" ? metrics.totalGateCount : 0;
  if (totalGates > 0 && vector.falsifiability < 0.7) {
    reasons.push(
      `Sub-optimal proportion of falsifiable gates (${falsifiable}/${totalGates})`,
    );
  } else if (totalGates === 0) {
    reasons.push("Zero falsifiable evidence gates configured in evaluation");
  }

  if (vector.stability < 0.6) {
    reasons.push(
      `Historical stability metric is below nominal floor (${(vector.stability * 100).toFixed(1)}%)`,
    );
  }

  if (vector.coverage < 0.5) {
    reasons.push(
      `Test coverage ratio is low or unobserved (${(vector.coverage * 100).toFixed(1)}%)`,
    );
  }

  if (passed && reasons.length === 0) {
    reasons.push(
      `Epistemic confidence verified with grade ${grade} (${(confidenceScore * 100).toFixed(1)}%)`,
    );
  }

  return {
    confidenceScore,
    grade,
    vector,
    passed,
    reasons,
  };
}
