import { HarnessError } from "../../core/errors/index.ts";
import { SEVERITY_WEIGHTS, SUPERVISORY_ROLE_BOUNDARIES } from "./constants.ts";
import { evaluateRoleInvariants } from "./eval-invariants.ts";
import { evaluateSubordinateFulfillment } from "./eval-subordinates.ts";
import { normalizeSupervisoryRole, parseNowMs } from "./profiles.ts";
import type {
  DriftFinding,
  DriftSeverity,
  ReflexiveAuditContext,
  ReflexiveAuditEvaluation,
} from "./types.ts";

export function evaluateReflexiveSelfAudit(
  context: ReflexiveAuditContext,
): ReflexiveAuditEvaluation {
  const supervisoryRole = normalizeSupervisoryRole(context.role);
  if (!supervisoryRole) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `role '${context.role}' is not a valid supervisory role for reflexive self-audit evaluation`,
    );
  }

  const roleBoundaries = SUPERVISORY_ROLE_BOUNDARIES[supervisoryRole];
  const findings: DriftFinding[] = [];
  const recommendedActions: string[] = [];
  const invariantCompliance: Record<string, boolean> = {
    zero_file_mutation: true,
    strict_tier_hierarchy: true,
    delegated_execution_only: true,
    background_finalization_confinement: true,
    write_scope_isolation: true,
    quantitative_proof_enforcement: true,
    active_wave_progression: true,
    no_premature_completion: true,
  };

  const nowMs = parseNowMs(context.now);
  const timestamp = new Date(nowMs).toISOString();

  // 1. Role Invariants Evaluation
  evaluateRoleInvariants(
    supervisoryRole,
    roleBoundaries,
    context,
    invariantCompliance,
    findings,
    recommendedActions,
  );

  // 2. Subordinate Fulfillment Evaluation
  const subordinateHealth = evaluateSubordinateFulfillment(
    context,
    invariantCompliance,
    findings,
    recommendedActions,
  );

  // 3. Behavioral Drift Detection
  // Drift 3.1: Complacency / Rubber-Stamping Drift
  const acceptedWithoutProof = context.validatorReviewsAcceptedWithoutProof ?? 0;
  if (acceptedWithoutProof > 0) {
    invariantCompliance.quantitative_proof_enforcement = false;
    findings.push({
      code: "COMPLACENCY_RUBBER_STAMPING_DRIFT",
      type: "behavioral_drift",
      severity: "high",
      title: "Complacent Validator Sign-Off Without Proof",
      description: `Accepted ${acceptedWithoutProof} validator pass(es) that lacked quantitative proof metrics (DOM bounds, APCA contrast, screenshot bytes > 1024B) or gate evidence.`,
      recommendation:
        "Apply coordinator scepticism. Issue `coordinator:pushback` on passes that do not provide rigorous quantitative proof.",
      evidence: { acceptedWithoutProof },
    });
    recommendedActions.push(
      "Execute `coordinator:pushback` on unverified validator claims and require quantitative screenshot/DOM evidence.",
    );
  }

  // Drift 3.2: Idling / Stalling Drift
  const readyCount = context.queueReadyCount ?? 0;
  const activeSubordinatesCount = subordinateHealth.activeCount;
  if (readyCount > 0 && activeSubordinatesCount === 0 && (context.queueBlockedCount ?? 0) === 0) {
    invariantCompliance.active_wave_progression = false;
    findings.push({
      code: "IDLING_STALLING_DRIFT",
      type: "behavioral_drift",
      severity: "medium",
      title: "Execution Idling with Ready Tasks in Queue",
      description: `Execution queue has ${readyCount} ready task(s) available, but 0 active subordinate workers are currently dispatched. Concurrency headroom is underutilized.`,
      recommendation:
        "Dispatch ready tasks immediately using `queue:wave` up to available concurrency slots (P = W / S).",
      evidence: { readyCount, activeSubordinatesCount },
    });
    recommendedActions.push("Dispatch ready tasks in parallel wave lanes using `queue:wave`.");
  }

  // Drift 3.3: Premature Completion Attempt
  if (context.attemptedPrematureCompletion) {
    const hasBlockers =
      subordinateHealth.activeCount > 0 ||
      (context.openFindingsCount ?? 0) > 0 ||
      (context.failedGatesCount ?? 0) > 0 ||
      (context.unprovenGatesCount ?? 0) > 0;

    if (hasBlockers) {
      invariantCompliance.no_premature_completion = false;
      findings.push({
        code: "PREMATURE_COMPLETION_DRIFT",
        type: "behavioral_drift",
        severity: "critical",
        title: "Premature Run Completion Attempt",
        description:
          "Attempted run completion while active subordinate leases, unresolved findings, unproven gates, or failed gates remain active.",
        recommendation:
          "Never declare completion until all wave gates pass, all leases are closed, and completeness critic approves with zero open findings.",
        evidence: {
          activeLeases: subordinateHealth.activeCount,
          openFindings: context.openFindingsCount,
          failedGates: context.failedGatesCount,
        },
      });
      recommendedActions.push(
        "Resolve all open findings and verify all gate proofs before calling `run:complete`.",
      );
    }
  }

  // Drift 3.4: Context Bloat Drift (reading raw source dumps)
  const rawReads = context.rawSourceFileReadsCount ?? 0;
  if (rawReads > 10) {
    findings.push({
      code: "CONTEXT_BLOAT_DRIFT",
      type: "behavioral_drift",
      severity: "low",
      title: "Context Bloat via Excessive Raw Source Reads",
      description: `Detected ${rawReads} raw file reads instead of utilizing high-leverage structured CLI verbs with JSON output.`,
      recommendation:
        "Leverage structured CLI commands (`run:status`, `dag:view`, `queue:list`) rather than dumping full source files into context.",
      evidence: { rawReads },
    });
    recommendedActions.push(
      "Use targeted CLI commands with `--format json` or bounded line limits to conserve context tokens.",
    );
  }

  // Calculate Drift Score & Overall Severity
  let rawScore = 0;
  for (const f of findings) {
    rawScore += SEVERITY_WEIGHTS[f.severity];
  }
  const driftScore = Math.min(1.0, Math.round(rawScore * 100) / 100);

  let overallSeverity: DriftSeverity = "none";
  if (findings.some((f) => f.severity === "critical")) {
    overallSeverity = "critical";
  } else if (findings.some((f) => f.severity === "high")) {
    overallSeverity = "high";
  } else if (findings.some((f) => f.severity === "medium")) {
    overallSeverity = "medium";
  } else if (findings.some((f) => f.severity === "low")) {
    overallSeverity = "low";
  }

  const passed = overallSeverity === "none" || (overallSeverity === "low" && driftScore < 0.2);

  const statusEmoji = passed
    ? "🟢 PASS"
    : overallSeverity === "critical"
      ? "🔴 CRITICAL DRIFT"
      : "🟡 WARNING";
  const groundingSummary = passed
    ? `Supervisory persona for ${supervisoryRole.toUpperCase()} is fully grounded and compliant with 0 critical drift findings.`
    : `Supervisory persona for ${supervisoryRole.toUpperCase()} exhibits ${overallSeverity.toUpperCase()} behavioral drift (drift score: ${driftScore}). ${findings.length} finding(s) detected.`;

  const reportLines: string[] = [];
  reportLines.push(
    `### 🛡️ Supervisory Reflexive Self-Audit Report: \`${supervisoryRole.toUpperCase()}\``,
  );
  reportLines.push(
    `- **Status**: ${statusEmoji} (Drift Score: \`${driftScore.toFixed(2)}\` / 1.00)`,
  );
  reportLines.push(`- **Tier**: Tier ${roleBoundaries.tier} (${roleBoundaries.tierName})`);
  reportLines.push(`- **Timestamp**: \`${timestamp}\``);
  reportLines.push(
    `- **Subordinate Health**: ${subordinateHealth.healthy ? "Healthy" : "Attention Required"} (${subordinateHealth.activeCount} active, ${subordinateHealth.staleCount} stale, ${subordinateHealth.conflictingScopeCount} conflicting)`,
  );
  reportLines.push("");

  reportLines.push("#### 📋 Invariant Compliance Matrix");
  for (const [invKey, isCompliant] of Object.entries(invariantCompliance)) {
    reportLines.push(
      `- ${isCompliant ? "✅" : "❌"} \`${invKey}\`: ${isCompliant ? "COMPLIANT" : "VIOLATION"}`,
    );
  }
  reportLines.push("");

  if (findings.length > 0) {
    reportLines.push("#### ⚠️ Reflexive Drift & Boundary Findings");
    for (const f of findings) {
      reportLines.push(`##### [${f.severity.toUpperCase()}] ${f.title} (\`${f.code}\`)`);
      reportLines.push(`- **Type**: \`${f.type}\``);
      reportLines.push(`- **Description**: ${f.description}`);
      reportLines.push(`- **Remediation**: ${f.recommendation}`);
      reportLines.push("");
    }
  }

  if (recommendedActions.length > 0) {
    reportLines.push("#### ⚡ Recommended Grounding Actions");
    for (let i = 0; i < recommendedActions.length; i++) {
      reportLines.push(`${i + 1}. ${recommendedActions[i]}`);
    }
    reportLines.push("");
  }

  const markdownReport = reportLines.join("\n").trim();

  return {
    role: supervisoryRole,
    tier: roleBoundaries.tier,
    timestamp,
    passed,
    driftScore,
    overallSeverity,
    findings,
    invariantCompliance,
    subordinateHealth,
    recommendedActions,
    groundingSummary,
    markdownReport,
  };
}
