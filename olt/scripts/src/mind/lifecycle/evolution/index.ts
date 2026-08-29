export type {
  SelfEvolutionMode,
  CadencePhase,
  SupervisoryRoleTier,
  OrchestratorNodeStatus,
  HierarchyScalingDirection,
  OrchestratorNodeInfo,
  ScalingThresholds,
  HierarchyCapacityMetrics,
  HierarchyScalingDecision,
  LoadBalancingAssignment,
  LoadBalancingPlan,
  SelfEvolutionCadenceState,
  PerpetualCadenceEvaluation,
  EvolutionLedgerEntry,
  EvolutionHistoryStats,
  SelfEvolutionCycleOptions,
} from "./self-evolution-chunk1.ts";

export {
  PERPETUAL_NON_STOPPING_CADENCE,
  NON_STOPPING_RULE,
  CLOSING_FORBIDDEN_IDLE_MIND,
  DEFAULT_EVOLUTION_BASE_INTERVAL_MS,
  DEFAULT_EVOLUTION_MAX_INTERVAL_MS,
  DEFAULT_SCALING_THRESHOLDS,
} from "./self-evolution-chunk1.ts";

export type {
  SelfEvolutionCycleResult,
} from "./self-evolution-chunk2.ts";

export {
  resolveEvolutionHistoryPath,
  readEvolutionHistory,
  recordEvolutionCycle,
  getEvolutionStats,
  enforcePerpetualNonStoppingCadence,
} from "./self-evolution-chunk2.ts";

export {
  calculateHierarchyCapacity,
  evaluateHierarchyScaling,
} from "./self-evolution-chunk3.ts";

export {
  balanceOrchestratorLoad,
  synthesizeDynamicPlanRevisions,
} from "./self-evolution-chunk4.ts";

export {
  evaluatePerpetualCadence,
  formatSelfEvolutionBrief,
} from "./self-evolution-chunk5.ts";

export {
  runSelfEvolutionCycle,
  executeSelfEvolutionStep,
} from "./self-evolution-chunk6.ts";
