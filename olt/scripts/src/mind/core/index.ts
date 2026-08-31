export { mindTaskDiscoveryCommand } from "./discovery-command.ts";

export { mindSelfEvolveCommand, mindStrategicCognitionCommand } from "./evolution-command.ts";

export {
  MIND_TASK_DISCOVERY_COMMAND_SPEC,
  MIND_SELF_EVOLVE_COMMAND_SPEC,
} from "./cognition-command.ts";

export { MIND_STRATEGIC_COGNITION_COMMAND_SPEC } from "./dispatch.ts";

export {
  evaluateMindMode,
  discoverGroundedFeatures,
  runMindProductManagerLoop,
  evaluateAntiStagnation,
  recordNonZeroProgress,
  type MindExecutionMode,
  type CreativeEvolutionStep,
  type GroundedFeatureProposal,
  type AntiStagnationState,
  type ProductManagerEvaluationResult,
  type ProductManagerExpansionResult,
  type MindProductManagerOptions,
} from "../lifecycle/orchestration/index.ts";
