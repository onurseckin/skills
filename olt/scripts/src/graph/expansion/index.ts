export type {
  SubtaskDecomposition,
  DeeperExpansionRequest,
  WiderExpansionRequest,
  DynamicExpansionOptions,
  SuggestedEdge,
  CognitiveGuidance,
  BypassViolation,
  TransitiveBypassCheckResult,
  TaskRolePair,
  DynamicExpansionResult,
  ImplementerValidatorConfig,
  DynamicExpansionPlan,
  AllocatedTaskElements,
} from "./types.ts";

export {
  parseGateCommand,
  createImplementerValidatorPair,
  allocateTaskElements,
} from "./subtask-allocator.ts";

export { detectTransitiveBypasses } from "./bypass-detector.ts";

export { expandDeeper } from "./task-decomposition.ts";

export { expandWider, expandDynamicPlan } from "./wider-expansion.ts";
