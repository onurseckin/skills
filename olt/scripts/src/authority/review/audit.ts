import {
  detectDomainBatching,
  evaluateCounterfactualEvidence,
  rejectSuperficialClaims,
} from "./evaluators.ts";
import type {
  PushbackHistory,
  ScepticismAuditOptions,
  ScepticismViolation,
  TaskVerificationAuditResult,
  TaskVerificationEvidenceInput,
} from "./types.ts";

export function auditTaskVerificationEvidence(
  evidence: TaskVerificationEvidenceInput,
  options: ScepticismAuditOptions = {},
): TaskVerificationAuditResult {
  const violations: ScepticismViolation[] = [];
  const rejectionReasons: string[] = [];
  const correctiveGuidance: string[] = [];

  if (!evidence.taskId || typeof evidence.taskId !== "string" || evidence.taskId.trim().length === 0) {
    violations.push({
      type: "empty_rationale",
      message: "Task ID is required for 1:1 individual task verification.",
    });
    rejectionReasons.push("Missing task ID in verification claim.");
  }

  const summary = evidence.summary ?? "";
  const superficiality = rejectSuperficialClaims(summary, evidence.evidence);
  if (superficiality.isSuperficial) {
    violations.push({
      type: "superficial_claim",
      message: superficiality.reason ?? "Superficial claim detected.",
      taskId: evidence.taskId,
      details: { confidence: superficiality.confidenceScore },
    });
    rejectionReasons.push(superficiality.reason ?? "Verification contains superficial rubber-stamping claim.");
    correctiveGuidance.push(
      "**Resolution Path:**\n1. Review the task requirements and assigned write scope.\n2. Extract concrete, task-specific observations (e.g., file paths, line references).\n3. Execute targeted test commands relevant to the task.\n4. Incorporate the test execution evidence directly into the verification claim.",
    );
  }

  const domains = options.requiredDomains ?? (["code-quality"] as const);
  const domainEvidence = evidence.domainEvidence ?? {};
  const domainBatching = detectDomainBatching(domains, domainEvidence);
  if (domainBatching.isBatched) {
    for (const reason of domainBatching.reasons) {
      violations.push({
        type: "domain_batching",
        message: reason,
        taskId: evidence.taskId,
      });
      rejectionReasons.push(reason);
    }
    correctiveGuidance.push(
      "**Resolution Path:**\n1. Separate the verification evidence for each required domain.\n2. Verify each domain independently with distinct checks.\n3. Ensure the evidence payload for each domain is unique and not copy-pasted.",
    );
  }

  const counterfactual = evaluateCounterfactualEvidence(
    evidence.counterfactualEvidence,
    evidence.checks,
  );
  if (options.requireCounterfactual && !counterfactual.isSufficient) {
    violations.push({
      type: "missing_counterfactual_evidence",
      message: "Missing discriminating counterfactual evidence or falsification proof.",
      taskId: evidence.taskId,
    });
    rejectionReasons.push(
      "Verification lacks counterfactual falsification proof demonstrating the check fails under negative conditions.",
    );
    correctiveGuidance.push(
      "**Resolution Path:**\n1. Formulate a negative hypothesis or edge-case scenario.\n2. Execute a check demonstrating that the condition would fail under this scenario.\n3. Document the falsification proof and the observation in the counterfactual evidence section.",
    );
  }

  const checks = evidence.checks ?? [];
  if (checks.length === 0 && (!evidence.evidence || evidence.evidence.length === 0)) {
    violations.push({
      type: "unsubstantiated_verdict",
      message: "No check commands or artifact proofs were provided for verification.",
      taskId: evidence.taskId,
    });
    rejectionReasons.push("Verification lacks any executed check commands or tangible evidence artifacts.");
    correctiveGuidance.push(
      "**Resolution Path:**\n1. Identify the task gate check command for this verification.\n2. Execute the command to verify functionality.\n3. Record the exact exit code and relevant output.\n4. Attach this structured proof to the verification verdict.",
    );
  } else {
    for (const check of checks) {
      if (check.exit_code !== undefined && check.exit_code !== 0) {
        violations.push({
          type: "unsubstantiated_verdict",
          message: `Check command '${check.command ?? check.command_id ?? "unknown"}' exited with non-zero code ${check.exit_code}.`,
          taskId: evidence.taskId,
          details: { exit_code: check.exit_code },
        });
        rejectionReasons.push(
          `Verification check command '${check.command ?? check.command_id ?? "unknown"}' failed with exit code ${check.exit_code}.`,
        );
      }
    }
  }

  let score = 100;
  if (superficiality.isSuperficial) score -= 35;
  if (domainBatching.isBatched) score -= 30;
  if (!counterfactual.isSufficient && options.requireCounterfactual) score -= 20;
  if (checks.length === 0) score -= 25;
  score = Math.max(0, Math.min(100, score - violations.length * 10));

  const valid = violations.length === 0 && rejectionReasons.length === 0;
  let recommendedAction: "accept" | "pushback_procedural" | "pushback_substantive" = "accept";
  if (!valid) {
    const hasSubstantive = violations.some(
      (v) => v.type === "unsubstantiated_verdict" || v.type === "stagnant_repair",
    );
    recommendedAction = hasSubstantive ? "pushback_substantive" : "pushback_procedural";
  }

  return {
    valid,
    scepticismScore: score,
    violations,
    rejectionReasons,
    superficiality,
    domainBatching,
    counterfactual,
    recommendedAction,
    correctiveGuidance,
  };
}

export function generateCorrectiveGuidance(
  history: PushbackHistory,
  auditResult?: TaskVerificationAuditResult | undefined,
): readonly string[] {
  const guidance: string[] = [];

  if (history.rounds.length > 0) {
    const latest = history.rounds.at(-1)!;
    guidance.push(`[Round ${latest.round} ${latest.cause.toUpperCase()} Pushback]: ${latest.observation}`);
    guidance.push(`Remediation Required: ${latest.remediation}`);
    for (const g of latest.correctiveGuidance) {
      if (!guidance.includes(g)) guidance.push(g);
    }
  }

  if (auditResult) {
    for (const g of auditResult.correctiveGuidance) {
      if (!guidance.includes(g)) guidance.push(g);
    }
    for (const r of auditResult.rejectionReasons) {
      guidance.push(`Resolve rejection reason: ${r}`);
    }
  }

  return guidance;
}
