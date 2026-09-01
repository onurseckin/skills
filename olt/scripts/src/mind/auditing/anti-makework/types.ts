/**
 * Anti-Make-Work Safeguards & Synthetic Churn Detection Types.
 *
 * Implements the Empirical Reality-Anchored Value Standard (Blueprint Section 11)
 * to prevent metric gaming, busywork loops, and synthetic productivity churn.
 */

/**
 * The Five Pillars of Genuine Value defined by the Sovereign Mind architecture.
 * Every legitimate task or initiative must advance at least one pillar.
 */
export type GenuineValuePillar =
  | "USER_FACING_DELIGHT_AND_POLISH"
  | "VERIFIED_DEFECT_ELIMINATION"
  | "MEASURABLE_PERFORMANCE_GAIN"
  | "ARCHITECTURAL_SIMPLIFICATION"
  | "FUNCTIONAL_EXPANSION";

/**
 * Constant list of all genuine value pillars.
 */
export const GENUINE_VALUE_PILLARS: readonly GenuineValuePillar[] = [
  "USER_FACING_DELIGHT_AND_POLISH",
  "VERIFIED_DEFECT_ELIMINATION",
  "MEASURABLE_PERFORMANCE_GAIN",
  "ARCHITECTURAL_SIMPLIFICATION",
  "FUNCTIONAL_EXPANSION",
] as const;

/**
 * Descriptions and empirical verification criteria for each genuine value pillar.
 */
export const GENUINE_VALUE_PILLAR_DEFINITIONS: Record<
  GenuineValuePillar,
  {
    readonly title: string;
    readonly description: string;
    readonly empiricalCriterion: string;
  }
> = {
  USER_FACING_DELIGHT_AND_POLISH: {
    title: "User-Facing Delight & Polish",
    description:
      "Observable refinement of visual aesthetics, responsiveness, intuitive interaction flows, and clear perceptual hierarchy.",
    empiricalCriterion:
      "Auditable visual/ergonomic walkthrough delta, sub-16ms tactile interaction, or UI clarity enhancement.",
  },
  VERIFIED_DEFECT_ELIMINATION: {
    title: "Verified Defect Elimination",
    description:
      "Removal of verified bugs, edge-case failures, unhandled error paths, and intermittent race conditions.",
    empiricalCriterion:
      "Reproducible failing test/witness converted to green status with zero regression.",
  },
  MEASURABLE_PERFORMANCE_GAIN: {
    title: "Measurable Performance Gain",
    description:
      "Quantifiable reduction in latency, memory overhead, bandwidth usage, or computational footprint.",
    empiricalCriterion:
      "Automated benchmark demonstrating statistically significant improvement (e.g., >=15% or verified memory/disk delta).",
  },
  ARCHITECTURAL_SIMPLIFICATION: {
    title: "Architectural Simplification",
    description:
      "Net reduction in cognitive complexity, elimination of redundant abstractions, removal of dead paths, and consolidation of decoupled contracts.",
    empiricalCriterion:
      "Measurable reduction in cyclomatic/cognitive complexity, net line reduction without loss of capability, or eliminated indirection.",
  },
  FUNCTIONAL_EXPANSION: {
    title: "Functional Expansion",
    description:
      "Delivery of new, fully verified product capabilities aligned with the strategic roadmap.",
    empiricalCriterion:
      "New feature paths with unit/integration test coverage fulfilling prioritized roadmap deliverables.",
  },
} as const;

/**
 * Types of synthetic churn detected by the anti-make-work system.
 */
export type SyntheticChurnType = "COSMETIC_CHURN" | "ABSTRACTION_BLOAT" | "SPECULATIVE_REFACTORING";

/**
 * Constant list of all synthetic churn types.
 */
export const SYNTHETIC_CHURN_TYPES: readonly SyntheticChurnType[] = [
  "COSMETIC_CHURN",
  "ABSTRACTION_BLOAT",
  "SPECULATIVE_REFACTORING",
] as const;

/**
 * Severity level of a synthetic churn violation.
 */
export type ChurnSeverity = "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * Detailed violation report when synthetic churn is detected in a proposed diff or task.
 */
export interface SyntheticChurnViolation {
  readonly type: SyntheticChurnType;
  readonly description: string;
  readonly evidence: string;
  readonly severity: ChurnSeverity;
}

/**
 * Input metrics and characteristics extracted from a proposed task diff or code change.
 */
export interface DiffAnalysisInput {
  readonly filesChanged: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly isRenameOnly?: boolean;
  readonly isCommentOnly?: boolean;
  readonly introducesWrapperLayers?: boolean;
  readonly benchmarkDeltaPercent?: number;
  readonly defectReportRef?: string | null;
  readonly cognitiveComplexityDelta?: number;
  readonly filePaths?: readonly string[];
  readonly rawSummary?: string;
}

/**
 * Task input payload for value and churn evaluation.
 */
export interface TaskEvaluationInput {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly proposedPillars: readonly GenuineValuePillar[];
  readonly diff?: DiffAnalysisInput;
}

/**
 * Result of evaluating a task against the Reality-Anchored Value Standard.
 */
export interface TaskValueEvaluation {
  readonly taskId: string;
  readonly title: string;
  readonly satisfiesPillars: readonly GenuineValuePillar[];
  readonly churnViolations: readonly SyntheticChurnViolation[];
  readonly isGenuineValue: boolean;
  readonly rejectionNotice: string | null;
  readonly score: number;
}
