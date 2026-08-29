export type {
  ProposalStatus,
  MindProposal,
  RecordProposalOptions,
  ProposalRateLimitCheckResult,
  ProposalAuthorityDecisionInput,
  DecideProposalOptions,
  TransitionProposalOptions,
  PlanRevisionSignalType,
  PlanRevisionType,
  PlanRevisionSignal,
  PlanRevisionTaskSpec,
  PlanRevisionProposal,
  GeneratePlanRevisionOptions,
  PlanRevisionApplicationResult,
  InitiativeActionType,
  InitiativeEvaluationInput,
  InitiativeEvaluationResult,
} from "./types.ts";

export {
  PROPOSAL_WITNESS_OWNER_DECISION,
  PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE,
  DEFAULT_MAX_OPEN_PROPOSALS,
  DEFAULT_PROPOSAL_MIN_INTERVAL_MS,
  DEFAULT_INITIATIVE_CONFIDENCE_THRESHOLD,
  VALID_PROPOSAL_TRANSITIONS,
} from "./types.ts";

export {
  parseNowMs,
  parseNowIso,
  normalizeText,
  calculateProposalFingerprint,
  isDuplicateProposal,
  canTransitionProposal,
  getAllProposals,
} from "./storage.ts";

export {
  getOpenProposals,
  getDeclinedProposals,
  getGrantedProposals,
  calculateRemainingCooldownMs,
  checkProposalRateLimits,
  findDeclinedProposalConflict,
  assertRoleMayDecideProposal,
} from "./validation.ts";

export { recordProposalInState } from "./creation.ts";

export {
  recordProposal,
  transitionProposalStatusInState,
  admitProposalInState,
  completeProposalInState,
} from "./transitions.ts";

export {
  decideProposalInState,
  decideProposal,
  isProposalGranted,
  isProposalAdmissible,
} from "./decide.ts";

export { generatePlanRevisionFromSignals, applyPlanRevisionInState } from "./reconcile.ts";

export {
  evaluateInitiativeTriggers,
  advanceProposalWithInitiative,
  formatProposalBrief,
  formatPlanRevisionBrief,
} from "./brief.ts";
