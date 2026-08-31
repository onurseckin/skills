/**
 * Mind Lifecycle Orchestration & Product Manager System.
 * Exports Mode A Creative Product Manager loops, anti-stagnation heuristics,
 * grounded feature discovery, and cognitive progress tracking.
 */

export {
  evaluateMindMode,
  discoverGroundedFeatures,
  runMindProductManagerLoop,
} from "./product-manager.ts";

export {
  evaluateAntiStagnation,
  computeProgressSignature,
  recordNonZeroProgress,
  type ProgressDeltaInput,
} from "./anti-stagnation.ts";

export type {
  MindExecutionMode,
  CreativeEvolutionStep,
  GroundedFeatureProposal,
  AntiStagnationState,
  ProductManagerEvaluationResult,
  ProductManagerExpansionResult,
  MindProductManagerOptions,
} from "./types.ts";
