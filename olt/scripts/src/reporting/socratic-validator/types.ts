export type SocraticDimension =
  | "premise_verification"
  | "edge_case_exploration"
  | "failure_mode_analysis"
  | "hierarchy_invariant_preservation"
  | "quantitative_empirical_proof"
  | "two_key_validator_pairing";

export interface SocraticDimensionMeta {
  key: SocraticDimension;
  title: string;
  description: string;
}

export const SOCRATIC_DIMENSIONS: readonly SocraticDimensionMeta[] = [
  {
    key: "premise_verification",
    title: "1. Premise Verification",
    description:
      "Question foundational assumptions, requirement definitions, and baseline repository context directly against disk artifacts rather than comments, types, or intent.",
  },
  {
    key: "edge_case_exploration",
    title: "2. Edge Case Exploration",
    description:
      "Probe boundary conditions, extreme input values, empty/single-item collections, maximum capacities, concurrent contention, and partial/transitional states.",
  },
  {
    key: "failure_mode_analysis",
    title: "3. Failure Mode Analysis",
    description:
      "Audit negative execution paths, error handling/propagation, catch-block swallowing, unhandled rejections, fault tolerance, and counterfactual falsifiability.",
  },
  {
    key: "hierarchy_invariant_preservation",
    title: "4. Hierarchy & Invariant Preservation",
    description:
      "Enforce 4-tier structural hierarchy, role segregation, write-scope boundaries, zero TypeScript any types, and zero linter/compiler suppressions.",
  },
  {
    key: "quantitative_empirical_proof",
    title: "5. Quantitative Empirical Proof",
    description:
      "Demand exact quantitative measurements (100% test pass rates, exact ms timings, exit code 0, DOM rects, APCA contrast) over qualitative or boilerplate sign-offs.",
  },
];

export interface SocraticQuestionEvaluation {
  id: string;
  dimension: SocraticDimension;
  title: string;
  question: string;
  answered: boolean;
  passed: boolean;
  verdict: "OPTIMAL" | "SATISFIED" | "DEFECT_FLAGGED";
  observation: string;
  evidence?: string | undefined;
  remediation?: string | undefined;
}

export interface SocraticAuditReport {
  healthy: boolean;
  questions_evaluated: number;
  questions_passed: number;
  questions_failed: number;
  dimensions: Record<
    SocraticDimension,
    { title: string; total: number; passed: number; failed: number }
  >;
  questions: SocraticQuestionEvaluation[];
  summary: string;
  issues: string[];
}
