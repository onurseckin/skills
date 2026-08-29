import { HarnessError } from "../../../core/errors/index.ts";
import {
  COGNITIVE_AUDIT_DIMENSIONS,
  MIN_COGNITIVE_SCORE,
  MAX_COGNITIVE_SCORE,
} from "./hyper-cognition-chunk1.ts";
import type {
  CognitiveAuditFinding,
  CognitiveScoreVector,
  HyperCognitivePulseReport,
  OptimizationProposal,
} from "./hyper-cognition-chunk1.ts";
import type { HyperPulseInput } from "./hyper-cognition-chunk2.ts";
import {
  computeCognitiveScoreVector,
  extractSystemMetricsFromState,
  runAutonomousAuditLoop,
} from "./hyper-cognition-chunk3.ts";
import {
  executeProactiveSelfQuestioningCycle,
  harvestPlanEnhancementsDuringPulse,
} from "./hyper-cognition-chunk4.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export function generateOptimizationProposals(
  findings: readonly CognitiveAuditFinding[],
  scoreVector: CognitiveScoreVector,
): readonly OptimizationProposal[] {
  const timestamp = new Date().toISOString();
  const proposals: OptimizationProposal[] = [];

  if (scoreVector.dagConcurrencyScore < 80) {
    proposals.push({
      id: `PROP-CONCURRENCY-BOOST-${Math.floor(Math.random() * 100000)}`,
      title: "DAG Critical Path De-Serialization",
      dimension: "dag_concurrency",
      expectedBenefit:
        "Prune false barrier dependencies and rebalance task execution across parallel waves.",
      riskAssessment: "low",
      targetFiles: [],
      scoreBoost: 15,
      status: "proposed",
      createdAt: timestamp,
    });
  }

  if (scoreVector.astPurityScore < 80) {
    proposals.push({
      id: `PROP-AST-PURITY-${Math.floor(Math.random() * 100000)}`,
      title: "Structural Fallback Elimination",
      dimension: "ast_purity",
      expectedBenefit:
        "Replace all ?? and || fallback operators with explicit type-narrowed assertions.",
      riskAssessment: "low",
      targetFiles: [],
      scoreBoost: 12,
      status: "proposed",
      createdAt: timestamp,
    });
  }

  if (scoreVector.typeSafetyScore < 80) {
    proposals.push({
      id: `PROP-TYPE-SAFETY-${Math.floor(Math.random() * 100000)}`,
      title: "Exhaustive Contract Boundary Hardening",
      dimension: "type_safety",
      expectedBenefit:
        "Inject strict runtime predicates and eliminate any remaining unvalidated types.",
      riskAssessment: "medium",
      targetFiles: [],
      scoreBoost: 10,
      status: "proposed",
      createdAt: timestamp,
    });
  }

  for (const finding of findings) {
    if (finding.severity === "critical" || finding.severity === "warning") {
      proposals.push({
        id: `PROP-FINDING-${finding.id}`,
        title: `Remediate ${finding.ruleId}`,
        dimension: finding.dimension,
        expectedBenefit: finding.remediation,
        riskAssessment: finding.severity === "critical" ? "medium" : "low",
        targetFiles: finding.targetPath !== undefined ? [finding.targetPath] : [],
        scoreBoost: finding.scoreImpact,
        status: "proposed",
        createdAt: timestamp,
      });
    }
  }

  return proposals;
}


export function evaluateCadenceHyperPulse(input: HyperPulseInput): HyperCognitivePulseReport {
  const timestamp = input.timestamp !== undefined ? input.timestamp : new Date().toISOString();
  const auditResult = runAutonomousAuditLoop(input.state, input.repositoryFiles);
  const metrics = extractSystemMetricsFromState(input.state, input.repositoryFiles);
  const scoreVector = computeCognitiveScoreVector(auditResult.findings, metrics);

  const questionCycle = executeProactiveSelfQuestioningCycle({
    cycleId: `CYCLE-${input.pulseId}`,
    state: input.state,
    repositoryFiles: input.repositoryFiles,
    timestamp,
  });

  const harvest = harvestPlanEnhancementsDuringPulse({
    pulseId: input.pulseId,
    state: input.state,
    repositoryFiles: input.repositoryFiles,
    pulseNumber: input.pulseNumber,
    timestamp,
  });

  const proposals = generateOptimizationProposals(auditResult.findings, scoreVector);

  let cadenceAction: CadenceHyperAction = "STEADY_EXECUTION";
  let rationale = "System execution is healthy and within optimal parameters.";

  if (auditResult.criticalCount > 0) {
    cadenceAction = "PROACTIVE_REPLAN";
    rationale = `Critical findings detected (${auditResult.criticalCount}); triggering proactive replan before proceeding.`;
  } else if (metrics.readyTasks > 0) {
    cadenceAction = "IMMEDIATE_ROLLOVER";
    rationale = `Active ready tasks (${metrics.readyTasks}) present; executing 0ms immediate rollover without idle delay.`;
  } else if (harvest.suggestedSubtasks.length > 0) {
    cadenceAction = "SYNTHESIZE_TASKS";
    rationale = `Plan enhancement harvested ${harvest.suggestedSubtasks.length} granular subtasks for execution.`;
  } else if (metrics.falseBarrierCount > 0) {
    cadenceAction = "AUDIT_DAG";
    rationale = `False barrier dependencies detected (${metrics.falseBarrierCount}); triggering dynamic DAG forensics audit.`;
  }

  return {
    pulseId: input.pulseId,
    pulseTimestamp: timestamp,
    activeQuestions: [questionCycle],
    auditResult,
    harvestedEnhancements: [harvest],
    proposals,
    scoreVector,
    cadenceAction,
    rationale,
  };
}


export function formatHyperCognitionBrief(report: HyperCognitivePulseReport): string {
  const lines: string[] = [];
  lines.push(`### Hyper-Active Mind Cognition Pulse Report: \`${report.pulseId}\``);
  lines.push(`- **Pulse Timestamp**: ${report.pulseTimestamp}`);
  lines.push(`- **Cadence Action**: \`${report.cadenceAction}\``);
  lines.push(`- **Rationale**: ${report.rationale}`);
  lines.push("");
  lines.push("#### Multidimensional Cognitive Scores");
  lines.push(`- **Composite Score**: \`${report.scoreVector.compositeScore}/100\``);
  lines.push(`  - Simplicity: \`${report.scoreVector.simplicityScore}\``);
  lines.push(`  - Performance: \`${report.scoreVector.performanceScore}\``);
  lines.push(`  - Observability: \`${report.scoreVector.observabilityScore}\``);
  lines.push(`  - Type Safety: \`${report.scoreVector.typeSafetyScore}\``);
  lines.push(`  - AST Purity: \`${report.scoreVector.astPurityScore}\``);
  lines.push(`  - DAG Concurrency: \`${report.scoreVector.dagConcurrencyScore}\``);
  lines.push("");
  lines.push("#### Proactive Self-Questioning");
  for (const q of report.activeQuestions) {
    lines.push(`- **[${q.dimension.toUpperCase()}]** *"${q.questionText}"*`);
    lines.push(`  - Hypothesis: ${q.hypothesis}`);
    for (const finding of q.investigationFindings) {
      lines.push(`  - Observation: ${finding}`);
    }
  }
  lines.push("");
  lines.push(
    `#### Autonomous Audit Findings (${report.auditResult.findings.length} findings, Critical: ${report.auditResult.criticalCount})`,
  );
  if (report.auditResult.findings.length === 0) {
    lines.push("- *Zero audit findings. System state is pristine.*");
  } else {
    for (const f of report.auditResult.findings) {
      lines.push(
        `- \`[${f.severity.toUpperCase()}]\` **${f.ruleId}**: ${f.description} (Remediation: ${f.remediation})`,
      );
    }
  }
  lines.push("");
  lines.push(`#### Harvested Plan Enhancements (${report.harvestedEnhancements.length})`);
  for (const h of report.harvestedEnhancements) {
    lines.push(`- Harvest \`${h.harvestId}\`: ${h.suggestedSubtasks.length} suggested subtasks`);
    for (const sub of h.suggestedSubtasks) {
      lines.push(
        `  - Subtask \`${sub.taskId}\`: "${sub.title}" (Scope: ${sub.writeScope.join(", ")})`,
      );
    }
  }
  lines.push("");
  lines.push(`#### Optimization Proposals (${report.proposals.length})`);
  for (const p of report.proposals) {
    lines.push(
      `- **${p.title}** [\`${p.dimension}\` | Risk: \`${p.riskAssessment}\` | +${p.scoreBoost} pts]`,
    );
    lines.push(`  - Expected Benefit: ${p.expectedBenefit}`);
  }

  return lines.join("\n");
}


export function validateHyperCognitiveReport(report: unknown): HyperCognitivePulseReport {
  if (!isRecord(report)) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport must be a non-null object");
  }
  if (typeof report.pulseId !== "string" || report.pulseId.trim().length === 0) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport missing valid pulseId");
  }
  if (typeof report.pulseTimestamp !== "string") {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport missing pulseTimestamp");
  }
  if (!Array.isArray(report.activeQuestions)) {
    throw new HarnessError(
      "INTEGRITY",
      "HyperCognitivePulseReport activeQuestions must be an array",
    );
  }
  if (!isRecord(report.auditResult)) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport auditResult must be an object");
  }
  if (!Array.isArray(report.harvestedEnhancements)) {
    throw new HarnessError(
      "INTEGRITY",
      "HyperCognitivePulseReport harvestedEnhancements must be an array",
    );
  }
  if (!Array.isArray(report.proposals)) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport proposals must be an array");
  }
  if (!isRecord(report.scoreVector)) {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport scoreVector must be an object");
  }
  if (typeof report.cadenceAction !== "string") {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport cadenceAction must be a string");
  }
  if (typeof report.rationale !== "string") {
    throw new HarnessError("INTEGRITY", "HyperCognitivePulseReport rationale must be a string");
  }

  return report as unknown as HyperCognitivePulseReport;
}
