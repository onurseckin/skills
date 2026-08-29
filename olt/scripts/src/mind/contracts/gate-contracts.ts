/**
 * Shared Leaf Contracts for Admission Gates & Counterfactuals
 */

export interface GateEvaluation {
  readonly gateName: string;
  readonly passed: boolean;
  readonly reason: string;
  readonly timestamp: string;
}

export interface CounterfactualHypothesis {
  readonly hypothesisId: string;
  readonly premise: string;
  readonly expectedOutcome: string;
  readonly observedOutcome?: string | undefined;
  readonly validated?: boolean | undefined;
}

export interface QuiesceState {
  readonly quiesced: boolean;
  readonly quiescedAt?: string | undefined;
  readonly reason?: string | undefined;
}
