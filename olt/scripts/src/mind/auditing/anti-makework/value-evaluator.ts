/**
 * Genuine Value Evaluator.
 *
 * Enforces the Five Pillars of Genuine Value against incoming tasks and diffs.
 * Rejects initiatives lacking empirical validation and mandates redirection to real deficits.
 */

import {
  GENUINE_VALUE_PILLARS,
  GENUINE_VALUE_PILLAR_DEFINITIONS,
  type DiffAnalysisInput,
  type GenuineValuePillar,
  type SyntheticChurnViolation,
  type TaskEvaluationInput,
  type TaskValueEvaluation,
} from "./types.ts";
import { SyntheticChurnDetector } from "./churn-detector.ts";

export class GenuineValueEvaluator {
  /**
   * Evaluates a task proposal and optional diff against genuine value pillars
   * and synthetic churn rules.
   */
  public static evaluateTask(task: TaskEvaluationInput): TaskValueEvaluation {
    // 1. Validate and deduplicate proposed pillars
    const uniqueProposed = Array.from(new Set(task.proposedPillars));
    const satisfiesPillars: readonly GenuineValuePillar[] = Object.freeze(
      uniqueProposed.filter((pillar) => GENUINE_VALUE_PILLARS.includes(pillar)),
    );

    // 2. Perform diff churn analysis if diff payload is supplied
    let churnViolations: readonly SyntheticChurnViolation[] = Object.freeze([]);
    if (task.diff !== undefined) {
      churnViolations = SyntheticChurnDetector.analyzeTaskForChurn(task.diff);
    }

    // 3. Determine genuine value qualification
    const hasValidPillars = satisfiesPillars.length > 0;
    const hasChurn = churnViolations.length > 0;
    const isGenuineValue = hasValidPillars && !hasChurn;

    // 4. Calculate empirical value score (0-100)
    const score = GenuineValueEvaluator.calculateScore(
      satisfiesPillars,
      churnViolations,
      isGenuineValue,
      task.diff,
    );

    // 5. Generate structured rejection notice if rejected
    const rejectionNotice = isGenuineValue
      ? null
      : GenuineValueEvaluator.buildRejectionNotice(task, satisfiesPillars, churnViolations);

    return {
      taskId: task.id,
      title: task.title,
      satisfiesPillars,
      churnViolations,
      isGenuineValue,
      rejectionNotice,
      score,
    };
  }

  /**
   * Computes an empirical value score (0 to 100) factoring in pillars, penalties, and diff quality.
   */
  private static calculateScore(
    satisfiesPillars: readonly GenuineValuePillar[],
    churnViolations: readonly SyntheticChurnViolation[],
    isGenuineValue: boolean,
    diff?: DiffAnalysisInput,
  ): number {
    if (satisfiesPillars.length === 0 && churnViolations.length === 0) {
      return 0;
    }

    // Base score: 40 points for first pillar + 15 for each additional pillar
    let base = 40 + Math.max(0, satisfiesPillars.length - 1) * 15;

    if (diff) {
      if (diff.defectReportRef && diff.defectReportRef.trim().length > 0) {
        base += 20;
      }
      if (diff.benchmarkDeltaPercent !== undefined && diff.benchmarkDeltaPercent > 0) {
        base += Math.min(25, Math.round(diff.benchmarkDeltaPercent * 0.5));
      }
      if (diff.cognitiveComplexityDelta !== undefined && diff.cognitiveComplexityDelta < 0) {
        base += Math.min(20, Math.abs(diff.cognitiveComplexityDelta) * 5);
      }
    }

    // Deduct penalties for synthetic churn violations
    let penalty = 0;
    for (const v of churnViolations) {
      if (v.severity === "CRITICAL") {
        penalty += 60;
      } else if (v.severity === "HIGH") {
        penalty += 40;
      } else {
        penalty += 25;
      }
    }

    let finalScore = Math.max(0, Math.min(100, base - penalty));

    if (!isGenuineValue) {
      finalScore = Math.min(finalScore, 40);
    } else {
      finalScore = Math.max(finalScore, 60);
    }

    return finalScore;
  }

  /**
   * Builds an actionable, structured rejection notice explaining why the initiative
   * lacks empirical value and mandating redirection to real product deficits.
   */
  public static buildRejectionNotice(
    task: TaskEvaluationInput,
    satisfiesPillars: readonly GenuineValuePillar[],
    churnViolations: readonly SyntheticChurnViolation[],
  ): string {
    const lines: string[] = [
      "================================================================================",
      "                ANTI-MAKE-WORK AUDIT: TASK INITIATIVE REJECTED                  ",
      "================================================================================",
      `Task ID:    ${task.id}`,
      `Title:      ${task.title}`,
      `Evaluation: REJECTED (Fails Reality-Anchored Value Standard)`,
      "",
      "--- DEFICIENCY ANALYSIS ---",
    ];

    if (satisfiesPillars.length === 0) {
      lines.push(
        "• ZERO GENUINE VALUE PILLARS SATISFIED:",
        "  The proposed initiative does not verifiably advance any of the Five Pillars of Genuine Value.",
        "  Activity without concrete user delight, defect elimination, performance gain, simplification, or functional expansion is classified as synthetic churn.",
      );
    }

    if (churnViolations.length > 0) {
      lines.push("• SYNTHETIC CHURN VIOLATIONS DETECTED:");
      for (const violation of churnViolations) {
        lines.push(
          `  - [${violation.type}] (Severity: ${violation.severity})`,
          `    Description: ${violation.description}`,
          `    Evidence:    ${violation.evidence}`,
        );
      }
    }

    lines.push(
      "",
      "--- MANDATED ACTION & REDIRECTION ---",
      "1. Immediately abort this synthetic make-work / busywork initiative.",
      "2. Redirect organizational capacity to genuine product deficits anchored to:",
      "",
    );

    for (const pillar of GENUINE_VALUE_PILLARS) {
      const def = GENUINE_VALUE_PILLAR_DEFINITIONS[pillar];
      lines.push(
        `  • ${def.title} (${pillar}):`,
        `    - Standard: ${def.description}`,
        `    - Verification: ${def.empiricalCriterion}`,
      );
    }

    lines.push(
      "",
      "Reference: Master Strategic Blueprint Section 11 (Reality-Anchored Value Standard).",
      "================================================================================",
    );

    return lines.join("\n");
  }

  /**
   * Instance method aliases for polymorphic / dependency-injected usage.
   */
  public evaluateTask(task: TaskEvaluationInput): TaskValueEvaluation {
    return GenuineValueEvaluator.evaluateTask(task);
  }

  public buildRejectionNotice(
    task: TaskEvaluationInput,
    satisfiesPillars: readonly GenuineValuePillar[],
    churnViolations: readonly SyntheticChurnViolation[],
  ): string {
    return GenuineValueEvaluator.buildRejectionNotice(task, satisfiesPillars, churnViolations);
  }
}

export const evaluateTaskValue = GenuineValueEvaluator.evaluateTask;
export const buildRejectionNotice = GenuineValueEvaluator.buildRejectionNotice;
