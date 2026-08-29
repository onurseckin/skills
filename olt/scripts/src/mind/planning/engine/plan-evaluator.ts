import {
  evaluateEpistemicConfidence,
  type EpistemicConfidenceResult,
} from "../../../core/epistemic/index.ts";

export interface PlanTaskInput {
  readonly id: string;
  readonly title: string;
  readonly gate?: string | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly dependencies?: readonly string[] | undefined;
}

export interface PlanEvaluationDocument {
  readonly planId?: string | undefined;
  readonly prompt?: string | undefined;
  readonly observations?: readonly string[] | undefined;
  readonly sources?: readonly string[] | undefined;
  readonly risks?: readonly string[] | undefined;
  readonly tasks: readonly PlanTaskInput[];
  readonly historicalStability?: number | undefined;
  readonly testCoverageRatio?: number | undefined;
}

export interface PlanEvaluationResult {
  readonly planId: string;
  readonly epistemic: EpistemicConfidenceResult;
  readonly totalTasks: number;
  readonly falsifiableTaskCount: number;
  readonly scopeOverlapWarnings: readonly string[];
  readonly readinessVerdict: "READY" | "REVISE" | "BLOCKED";
}

export function detectScopeOverlapWarnings(tasks: readonly PlanTaskInput[]): string[] {
  const warnings: string[] = [];
  const scopeMap = new Map<string, string[]>();

  for (const task of tasks) {
    for (const scope of task.write_scope ?? []) {
      const existing = scopeMap.get(scope) ?? [];
      existing.push(task.id);
      scopeMap.set(scope, existing);
    }
  }

  for (const [scope, taskIds] of scopeMap.entries()) {
    if (taskIds.length > 1) {
      warnings.push(`Concurrent write scope collision on '${scope}' between tasks: ${taskIds.join(", ")}`);
    }
  }

  return warnings;
}

export function evaluatePlanEpistemicReadiness(
  doc: PlanEvaluationDocument,
  passThreshold?: number,
): PlanEvaluationResult {
  const planId = doc.planId?.trim() || "anonymous-plan";
  const tasks = doc.tasks ?? [];
  const totalTasks = tasks.length;

  const falsifiableTaskCount = tasks.filter((t) => {
    const gate = t.gate?.trim();
    return gate && gate.length > 0 && !gate.startsWith("echo ") && !gate.startsWith("true");
  }).length;

  const empiricalEvidenceCount = (doc.sources?.length ?? 0) + (doc.observations?.length ?? 0);
  const contradictionCount = (doc.risks ?? []).filter((r) => {
    const lower = r.toLowerCase();
    return lower.includes("contradiction") || lower.includes("conflict") || lower.includes("incompatible");
  }).length;

  const epistemic = evaluateEpistemicConfidence(
    {
      empiricalEvidenceCount,
      contradictionCount,
      falsifiableGateCount: falsifiableTaskCount,
      totalGateCount: totalTasks > 0 ? totalTasks : 1,
      historicalStability: doc.historicalStability ?? 1.0,
      testCoverageRatio: doc.testCoverageRatio ?? 0.85,
    },
    passThreshold,
  );

  const scopeOverlapWarnings = detectScopeOverlapWarnings(tasks);

  let readinessVerdict: "READY" | "REVISE" | "BLOCKED" = "BLOCKED";
  if (epistemic.passed && scopeOverlapWarnings.length === 0) {
    readinessVerdict = "READY";
  } else if (epistemic.confidenceScore >= 0.50) {
    readinessVerdict = "REVISE";
  }

  return {
    planId,
    epistemic,
    totalTasks,
    falsifiableTaskCount,
    scopeOverlapWarnings,
    readinessVerdict,
  };
}
