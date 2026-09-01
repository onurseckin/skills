export type {
  SocraticRoundNumber,
  SocraticRoundId,
  SocraticRoundDefinition,
  CognitiveChallengeSeverity,
  CognitiveChallengeStatus,
  DefenseRecord,
  CognitiveChallenge,
  CreateChallengeInput,
  DefenseSubmission,
  DefenseEvaluationResult,
  CollateralDefect,
  InterRoundAuditResult,
  CompetingForce,
  CandidateResolution,
  ParetoArbitrationInput,
  ParetoArbitrationDecision,
  RoundGateEvaluation,
  RoundAdvanceResult,
  SocraticSessionSummary,
  DialecticSessionOptions,
} from "./types.ts";

export {
  MANDATORY_CHALLENGE_QUOTA_R1_R4,
  MAX_CONVERGENCE_CYCLES_PER_GATE,
  MIN_SUBSTANTIVE_DEFENSE_LENGTH,
  SOCRATIC_ROUNDS,
  SOCRATIC_ROUND_MAP,
  TRIVIAL_DEFENSE_PATTERNS,
} from "./types.ts";

export { evaluateSubstantiveDefense } from "./defense-evaluator.ts";
export { InterRoundRegressionAuditor } from "./regression-auditor.ts";
export { ParetoArbitrationEngine } from "./pareto-arbitration.ts";

export { raiseChallenge, submitDefense, escalateToParetoArbitration } from "./dialectic-cycle.ts";

export { evaluateRoundReadiness, auditInterRoundState, advanceRound } from "./round-flow.ts";

export {
  SocraticDialecticEngine,
  getDefaultSocraticDialecticEngine,
  setDefaultSocraticDialecticEngine,
  resetDefaultSocraticDialecticEngine,
} from "./engine.ts";
