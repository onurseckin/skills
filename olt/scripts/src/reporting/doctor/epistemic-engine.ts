import {
  evaluateEpistemicConfidence,
  type EpistemicEvaluationInput,
  type EpistemicWeights,
} from "../../core/epistemic/index.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface EpistemicConfidenceCheckOptions {
  readonly metrics?: EpistemicEvaluationInput | Record<string, unknown> | undefined;
  readonly threshold?: number | undefined;
  readonly weights?: EpistemicWeights | undefined;
  readonly repoRoot?: string | undefined;
}

export function checkEpistemicConfidence(
  options: EpistemicConfidenceCheckOptions = {},
): DoctorCheckEngineResult {
  const metrics: EpistemicEvaluationInput = (options.metrics as EpistemicEvaluationInput) ?? {
    empiricalEvidenceCount: 5,
    contradictionCount: 0,
    falsifiableGateCount: 4,
    totalGateCount: 4,
    historicalStability: 1.0,
    testCoverageRatio: 0.95,
  };

  const verdict = evaluateEpistemicConfidence(metrics, {
    threshold: options.threshold,
    weights: options.weights,
  });

  const findings: DoctorDiagnosticFinding[] = [];

  if (!verdict.passed) {
    const severity = verdict.confidenceScore < 0.5 ? "ERROR" : "WARN";
    findings.push({
      code: "EPISTEMIC_CONFIDENCE_BELOW_THRESHOLD",
      severity,
      engine: "checkEpistemicConfidence",
      message: `Epistemic confidence score ${(verdict.confidenceScore * 100).toFixed(1)}% is below threshold (Grade: ${verdict.grade}). Reasons: ${verdict.reasons.join("; ")}`,
      details: {
        confidenceScore: verdict.confidenceScore,
        grade: verdict.grade,
        vector: verdict.vector,
        reasons: verdict.reasons,
      },
    });
  }

  const contradictionCount =
    typeof metrics.contradictionCount === "number" ? metrics.contradictionCount : 0;
  if (contradictionCount > 0) {
    findings.push({
      code: "EPISTEMIC_CONTRADICTIONS_DETECTED",
      severity: "ERROR",
      engine: "checkEpistemicConfidence",
      message: `Detected ${contradictionCount} logical contradiction${contradictionCount === 1 ? "" : "s"} in epistemic claim verification`,
      details: { contradictionCount },
    });
  }

  const totalGates = typeof metrics.totalGateCount === "number" ? metrics.totalGateCount : 0;
  const falsifiable =
    typeof metrics.falsifiableGateCount === "number" ? metrics.falsifiableGateCount : 0;
  if (totalGates > 0 && falsifiable < totalGates) {
    findings.push({
      code: "EPISTEMIC_UNFALSIFIABLE_GATES",
      severity: "WARN",
      engine: "checkEpistemicConfidence",
      message: `${totalGates - falsifiable} of ${totalGates} evidence gates are non-falsifiable`,
      details: { falsifiableGateCount: falsifiable, totalGateCount: totalGates },
    });
  }

  const hasErrors = findings.some((f) => f.severity === "ERROR");

  return {
    engine: "checkEpistemicConfidence",
    passed: verdict.passed && !hasErrors,
    findings,
  };
}
