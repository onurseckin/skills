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
} from "./expansion/types.ts";

export {
  parseGateCommand,
  createImplementerValidatorPair,
  allocateTaskElements,
} from "./expansion/subtask-allocator.ts";

export { detectTransitiveBypasses } from "./expansion/bypass-detector.ts";

export { expandDeeper } from "./expansion/task-decomposition.ts";

export { expandWider, expandDynamicPlan } from "./expansion/wider-expansion.ts";
