import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import {
  type SocraticAuditReport,
  type SocraticQuestionEvaluation,
  SOCRATIC_DIMENSIONS,
  type SocraticDimension,
} from "./types.ts";
import {
  evaluatePremiseVerification,
  evaluateEdgeCaseExploration,
  evaluateFailureModeAnalysis,
} from "./evaluators-1.ts";
import {
  evaluateHierarchyAndInvariants,
  evaluateQuantitativeEmpiricalProof,
  evaluateTwoKeyValidatorPairing,
} from "./evaluators-2.ts";

export function evaluateSocraticSelfQuestioning(
  _runRoot: string,
  state?: JsonObject | null,
): SocraticAuditReport {
  const safeState: JsonObject = isJsonObject(state) ? state : {};

  const allQuestions: SocraticQuestionEvaluation[] = [
    ...evaluatePremiseVerification(safeState),
    ...evaluateEdgeCaseExploration(safeState),
    ...evaluateFailureModeAnalysis(safeState),
    ...evaluateHierarchyAndInvariants(safeState),
    ...evaluateQuantitativeEmpiricalProof(safeState),
    ...evaluateTwoKeyValidatorPairing(safeState),
  ];

  const dimensions: Record<
    SocraticDimension,
    { title: string; total: number; passed: number; failed: number }
  > = {
    premise_verification: { title: "Premise Verification", total: 0, passed: 0, failed: 0 },
    edge_case_exploration: { title: "Edge Case Exploration", total: 0, passed: 0, failed: 0 },
    failure_mode_analysis: { title: "Failure Mode Analysis", total: 0, passed: 0, failed: 0 },
    hierarchy_invariant_preservation: {
      title: "Hierarchy & Invariant Preservation",
      total: 0,
      passed: 0,
      failed: 0,
    },
    quantitative_empirical_proof: {
      title: "Quantitative Empirical Proof",
      total: 0,
      passed: 0,
      failed: 0,
    },
    two_key_validator_pairing: {
      title: "Two-Key Validator Pairing",
      total: 0,
      passed: 0,
      failed: 0,
    },
  };

  const issues: string[] = [];

  for (const q of allQuestions) {
    const dim = dimensions[q.dimension];
    if (dim) {
      dim.total += 1;
      if (q.passed) {
        dim.passed += 1;
      } else {
        dim.failed += 1;
      }
    }
    if (!q.passed) {
      issues.push(`socratic [${q.verdict}] (${q.dimension}/${q.id}): ${q.observation}`);
    }
  }

  const passedCount = allQuestions.filter((q) => q.passed).length;
  const failedCount = allQuestions.length - passedCount;
  const healthy = failedCount === 0;

  const summary = healthy
    ? `Socratic Reflexive Self-Questioning verified: all ${allQuestions.length}/${allQuestions.length} criteria satisfied across 6 dimensions.`
    : `Socratic Reflexive Self-Questioning flagged ${failedCount} issue(s) across ${allQuestions.length} criteria.`;

  return {
    healthy,
    questions_evaluated: allQuestions.length,
    questions_passed: passedCount,
    questions_failed: failedCount,
    dimensions,
    questions: allQuestions,
    summary,
    issues,
  };
}

export function formatSocraticAuditSection(report: SocraticAuditReport): string {
  const lines: string[] = ["### Socratic Reflexive Self-Questioning Engine"];

  if (report.healthy) {
    lines.push(
      `- **Status**: verified (${report.questions_passed}/${report.questions_evaluated} criteria satisfied across 6 dimensions)`,
    );
    lines.push("- **Dimensions Evaluated**:");
    for (const meta of SOCRATIC_DIMENSIONS) {
      const dim = report.dimensions[meta.key];
      lines.push(`  - **${meta.title}**: clean (${dim.passed}/${dim.total} optimal)`);
    }
  } else {
    lines.push(
      `- **Status**: issues detected (${report.questions_failed} failed, ${report.questions_passed}/${report.questions_evaluated} passed)`,
    );
    lines.push("- **Issues**:");
    for (const q of report.questions) {
      if (!q.passed) {
        lines.push(`  - \`[${q.verdict}]\` **${q.id}** (${q.title}): ${q.observation}`);
        if (q.remediation) {
          lines.push(`    - *Remediation*: ${q.remediation}`);
        }
      }
    }
  }

  return lines.join("\n");
}
