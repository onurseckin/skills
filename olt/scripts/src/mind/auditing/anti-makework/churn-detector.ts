/**
 * Synthetic Churn Detector.
 *
 * Enforces Anti-Make-Work Safeguards by identifying cosmetic churn,
 * abstraction bloat, and speculative refactoring in proposed code changes.
 */

import type { DiffAnalysisInput, SyntheticChurnViolation } from "./types.ts";

export class SyntheticChurnDetector {
  /**
   * Detects cosmetic churn: symbol renames, file moves, comment or whitespace churn
   * without any semantic, architectural, or functional delta.
   */
  public static detectCosmeticChurn(diff: DiffAnalysisInput): SyntheticChurnViolation | null {
    const isRename = diff.isRenameOnly === true;
    const isComment = diff.isCommentOnly === true;

    if (isRename && isComment) {
      return {
        type: "COSMETIC_CHURN",
        description:
          "Cosmetic churn detected: changes consist entirely of symbol renames and comment/formatting adjustments without semantic or functional enhancement.",
        evidence: `filesChanged=${diff.filesChanged}, linesAdded=${diff.linesAdded}, linesRemoved=${diff.linesRemoved}, isRenameOnly=true, isCommentOnly=true`,
        severity: "HIGH",
      };
    }

    if (isRename) {
      const severity =
        diff.linesAdded + diff.linesRemoved > 50 || diff.filesChanged >= 4 ? "HIGH" : "MEDIUM";
      return {
        type: "COSMETIC_CHURN",
        description:
          "Cosmetic churn detected: modifications consist entirely of variable/symbol renames or file reorganizations without functional or structural gain.",
        evidence: `filesChanged=${diff.filesChanged}, linesAdded=${diff.linesAdded}, linesRemoved=${diff.linesRemoved}, isRenameOnly=true`,
        severity,
      };
    }

    if (isComment) {
      const severity = diff.linesAdded + diff.linesRemoved > 100 ? "HIGH" : "MEDIUM";
      return {
        type: "COSMETIC_CHURN",
        description:
          "Cosmetic churn detected: modifications consist entirely of comment, docstring, or whitespace adjustments without functional delta.",
        evidence: `filesChanged=${diff.filesChanged}, linesAdded=${diff.linesAdded}, linesRemoved=${diff.linesRemoved}, isCommentOnly=true`,
        severity,
      };
    }

    return null;
  }

  /**
   * Detects abstraction bloat: unnecessary wrapper layers, speculative generic interfaces,
   * or indirection bloat that increases cognitive complexity without empirical justification.
   */
  public static detectAbstractionBloat(diff: DiffAnalysisInput): SyntheticChurnViolation | null {
    const complexityDelta = diff.cognitiveComplexityDelta ?? 0;
    const hasBenchmarkGain =
      diff.benchmarkDeltaPercent !== undefined && diff.benchmarkDeltaPercent > 0;
    const hasDefectReport =
      diff.defectReportRef !== undefined &&
      diff.defectReportRef !== null &&
      diff.defectReportRef.trim().length > 0;

    if (diff.introducesWrapperLayers === true) {
      let severity: "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM";
      if (complexityDelta > 5) {
        severity = "CRITICAL";
      } else if (complexityDelta > 0 || !hasDefectReport) {
        severity = "HIGH";
      }

      return {
        type: "ABSTRACTION_BLOAT",
        description:
          "Abstraction bloat detected: introducing unnecessary wrapper layers, speculative generic interfaces, or indirection that adds cognitive load without immediate functional necessity.",
        evidence: `introducesWrapperLayers=true, cognitiveComplexityDelta=+${complexityDelta}, filesChanged=${diff.filesChanged}, linesAdded=${diff.linesAdded}`,
        severity,
      };
    }

    if (complexityDelta > 8 && !hasBenchmarkGain && !hasDefectReport) {
      return {
        type: "ABSTRACTION_BLOAT",
        description: `Abstraction bloat detected: substantial cognitive complexity increase (+${complexityDelta}) without defect report or benchmark justification.`,
        evidence: `cognitiveComplexityDelta=+${complexityDelta}, benchmarkDelta=${diff.benchmarkDeltaPercent ?? 0}%, defectReportRef=none`,
        severity: complexityDelta > 15 ? "CRITICAL" : "HIGH",
      };
    }

    return null;
  }

  /**
   * Detects speculative refactoring: rewriting stable, well-tested code without
   * an empirical defect report, measurable benchmark improvement, or architectural simplification.
   */
  public static detectSpeculativeRefactoring(
    diff: DiffAnalysisInput,
  ): SyntheticChurnViolation | null {
    if (diff.isRenameOnly || diff.isCommentOnly) {
      return null;
    }

    const totalLines = diff.linesAdded + diff.linesRemoved;
    const isSubstantialDiff = totalLines >= 30 || diff.filesChanged >= 3;

    const hasDefectReport =
      diff.defectReportRef !== undefined &&
      diff.defectReportRef !== null &&
      diff.defectReportRef.trim().length > 0;

    const hasBenchmarkGain =
      diff.benchmarkDeltaPercent !== undefined && diff.benchmarkDeltaPercent > 0;

    const isSimplification =
      diff.cognitiveComplexityDelta !== undefined && diff.cognitiveComplexityDelta < 0;

    if (isSubstantialDiff && !hasDefectReport && !hasBenchmarkGain && !isSimplification) {
      const severity = totalLines > 150 || diff.filesChanged >= 6 ? "CRITICAL" : "HIGH";

      return {
        type: "SPECULATIVE_REFACTORING",
        description:
          "Speculative refactoring detected: rewriting stable code without an empirical defect report, measurable benchmark gain, or cognitive complexity reduction.",
        evidence: `filesChanged=${diff.filesChanged}, linesAdded=${diff.linesAdded}, linesRemoved=${diff.linesRemoved}, defectReportRef=${diff.defectReportRef ?? "none"}, benchmarkDelta=${diff.benchmarkDeltaPercent ?? 0}%, complexityDelta=${diff.cognitiveComplexityDelta ?? 0}`,
        severity,
      };
    }

    return null;
  }

  /**
   * Analyzes a task's diff against all synthetic churn detectors.
   */
  public static analyzeTaskForChurn(diff: DiffAnalysisInput): readonly SyntheticChurnViolation[] {
    const violations: SyntheticChurnViolation[] = [];

    const cosmetic = SyntheticChurnDetector.detectCosmeticChurn(diff);
    if (cosmetic !== null) {
      violations.push(cosmetic);
    }

    const bloat = SyntheticChurnDetector.detectAbstractionBloat(diff);
    if (bloat !== null) {
      violations.push(bloat);
    }

    const speculative = SyntheticChurnDetector.detectSpeculativeRefactoring(diff);
    if (speculative !== null) {
      violations.push(speculative);
    }

    return Object.freeze(violations);
  }

  /**
   * Instance method aliases for polymorphic / dependency-injected usage.
   */
  public detectCosmeticChurn(diff: DiffAnalysisInput): SyntheticChurnViolation | null {
    return SyntheticChurnDetector.detectCosmeticChurn(diff);
  }

  public detectAbstractionBloat(diff: DiffAnalysisInput): SyntheticChurnViolation | null {
    return SyntheticChurnDetector.detectAbstractionBloat(diff);
  }

  public detectSpeculativeRefactoring(diff: DiffAnalysisInput): SyntheticChurnViolation | null {
    return SyntheticChurnDetector.detectSpeculativeRefactoring(diff);
  }

  public analyzeTaskForChurn(diff: DiffAnalysisInput): readonly SyntheticChurnViolation[] {
    return SyntheticChurnDetector.analyzeTaskForChurn(diff);
  }
}

export const detectCosmeticChurn = SyntheticChurnDetector.detectCosmeticChurn;
export const detectAbstractionBloat = SyntheticChurnDetector.detectAbstractionBloat;
export const detectSpeculativeRefactoring = SyntheticChurnDetector.detectSpeculativeRefactoring;
export const analyzeTaskForChurn = SyntheticChurnDetector.analyzeTaskForChurn;
