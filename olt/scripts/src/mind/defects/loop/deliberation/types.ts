import type {
  DefectCategory,
  DefectEntry,
  DefectHypothesis,
  DefectRemediationAction,
} from "../../core/types.ts";

export type DeliberationStatus = "deliberating" | "converged" | "exhausted";
export type DeliberationRecommendation = "advance_round" | "converge" | "halt_for_human";

export interface ResolutionProof {
  readonly task_id: string;
  readonly test_assertion: string;
  readonly resolved_at: string;
  readonly commit_sha?: string | undefined;
}

export interface DeliberationSynthesis {
  readonly round_number: number;
  readonly total_defects: number;
  readonly resolved_defect_ids: readonly string[];
  readonly unresolved_defect_ids: readonly string[];
  readonly recommended_actions: readonly DefectRemediationAction[];
  readonly consensus_reached: boolean;
  readonly summary: string;
  readonly recommendation: DeliberationRecommendation;
  readonly readiness_for_convergence: boolean;
}

export interface DefectDeliberationRound {
  readonly round_number: number;
  readonly capsule_root?: string | undefined;
  readonly status: DeliberationStatus;
  readonly defect_ids: readonly string[];
  readonly defects: readonly DefectEntry[];
  readonly hypotheses: readonly DefectHypothesis[];
  readonly remediation_actions: readonly DefectRemediationAction[];
  readonly actions: readonly DefectRemediationAction[];
  readonly proofs: readonly ResolutionProof[];
  readonly synthesis: DeliberationSynthesis;
}
