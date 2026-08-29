export {
  type ReviewerRole,
  type CriticFindingInput,
  type CriticFindingDetail,
  type PairAssignmentStrategy,
  type ImplementerValidatorBinding,
  type ClosedLoopRepairPayload,
  type CompiledRepairDagNode,
  type CompiledRepairDag,
  type RouteCriticFeedbackOptions,
  type ConvergenceReport,
} from "./critic-types.ts";

export {
  deriveCounterfactualRequirement,
  normalizeCriticFinding,
  selectImplementerValidatorPair,
  detectDeterministicRepeat,
  matchTasksForFinding,
  parseCriticFindingsInput,
} from "./critic-normalization.ts";

export { compileRepairDag, evaluateRepairCycleConvergence } from "./repair-dag.ts";

export { routeCriticFeedback, type RouteCriticFeedbackResult } from "./critic-feedback.ts";
