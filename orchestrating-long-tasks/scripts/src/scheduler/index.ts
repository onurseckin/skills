export { proposeBatch } from "./propose-batch.ts";
export { schedulingMetrics } from "./metrics.ts";
export { resourceConflict, scopeConflict } from "./conflicts.ts";
export { computeTopology, type TopologyConfig, type TopologyInputs } from "./topology.ts";
export { recordTopology } from "./persist-topology.ts";
export { readySet, type ReadyEntry, type ReadySetSelection } from "./ready-set.ts";
export {
  computeWorkSpanMetrics,
  partitionOrchestratorDomains,
  calculateValidatorAllocations,
  calculateCriticConcurrency,
  synthesizeDynamicTopology,
  type WorkSpanMetrics,
  type OrchestratorPartition,
  type CrossOrchestratorBarrier,
  type ValidatorDemand,
  type DynamicTopologyWave,
  type DynamicTopologyOptions,
  type DynamicTopologySynthesis,
} from "./dynamic-topology.ts";
export {
  evaluateHierarchicalDecision,
  assertHierarchicalCompliance,
  HIERARCHICAL_TIERS,
  type AgentRoleHierarchy,
  type HierarchicalAction,
  type HierarchicalDecisionContext,
  type HierarchicalDecisionResult,
} from "./decision-tree.ts";
