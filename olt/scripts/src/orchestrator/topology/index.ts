/**
 * Explicit named facade for the topology domain.
 */

export type {
  AcyclicityValidationResult,
  CriticFeedbackAdjustment,
  DependencyRule,
  DominatingSkillQualityReport,
  SerializationRule,
  SkillRequirementAdjustment,
  SynthesizedTaskSpec,
  SynthesizedTopology,
  TaskDecomposition,
  TopologyDecisionRecord,
  TopologySynthesisSpec,
  TopologyWavePlan,
} from "./types.ts";

export { normalizeScope, doScopesOverlap, checkScopeListOverlap } from "./scopes.ts";
export { validateTopologyAcyclicity } from "./acyclicity.ts";
export { computeCriticalPath } from "./critical-path.ts";
export { assertDominatingSkillQuality } from "./quality.ts";
export { partitionTopologyWaves, decoupleIndependentWaves } from "./waves.ts";
export { synthesizeDAGTopology } from "./synthesis.ts";
export { adaptTopologyWithCriticFeedback } from "./adaptation.ts";
