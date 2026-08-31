/**
 * Facade for DAG topology synthesis, wave partitioning, and validation.
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
} from "./topology/index.ts";

export {
  adaptTopologyWithCriticFeedback,
  assertDominatingSkillQuality,
  checkScopeListOverlap,
  computeCriticalPath,
  decoupleIndependentWaves,
  doScopesOverlap,
  normalizeScope,
  partitionTopologyWaves,
  synthesizeDAGTopology,
  validateTopologyAcyclicity,
} from "./topology/index.ts";
