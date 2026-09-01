export type {
  AgentArchetypeId,
  AgentOperationalContract,
  AgentTier,
  AgentTierCategory,
  CertifiedDeliverable,
  OpticalDimension,
  SyntheticState,
  ToolBoundaryDefinition,
} from "./fleet/index.ts";

export {
  ALL_31_AGENT_ARCHETYPES,
  CONTRACTS_LIST,
  CONTRACTS_TIER_0_1,
  CONTRACTS_TIER_2,
  CONTRACTS_TIER_3_EXEC,
  CONTRACTS_TIER_3_QUALITY_CRITICS,
  CONTRACTS_TIER_3_QUALITY_UI,
  FLEET_CONTRACT_REGISTRY,
  FORBIDDEN_EXEC_TOOLS,
  FORBIDDEN_WRITE_TOOLS,
  MANDATORY_VIEWPORTS_4,
  OPTICAL_DIMENSIONS_8,
  SYNTHETIC_STATES_4,
  TIER_0_1_GOVERNANCE_AGENTS,
  TIER_2_ORCHESTRATION_AGENTS,
  TIER_3_EXECUTION_AGENTS,
  TIER_3_QUALITY_AGENTS,
  defineContract,
  getAgentContract,
  getAllAgentArchetypes,
  isHeadfulReviewer,
  isHeadlessDebugger,
  isSourceCodeBlind,
  listAgentsByCategory,
  listAgentsByTier,
  normalizeAgentRole,
  requireAgentContract,
  validateAgentSpawn,
  validateAgentToolCall,
} from "./fleet/index.ts";

export type {
  ComplexityClassificationResult,
  ComplexityMetrics,
  DecompositionEvaluationResult,
  SwarmDispatchPlan,
  TaskComplexityInput,
  TaskComplexityLevel,
  TaskScopeEstimate,
} from "./sovereign-equilibrium.ts";

export {
  AntiOverheadWatchdog,
  classifyTaskComplexity,
  defaultAntiOverheadWatchdog,
  generateSwarmDispatchPlan,
} from "./sovereign-equilibrium.ts";

export type {
  EpistemicShardResult,
  FastForwardSyncResult,
  ReclamationReport,
  ShardMode,
  SymlinkCacheResult,
  WorktreeLease,
} from "./worktree/index.ts";

export {
  DEFAULT_CACHE_DIRECTORIES,
  DEFAULT_LEASE_DURATION_MS,
  cleanupEpistemicShard,
  createEpistemicShard,
  createWorktreeLease,
  getWorktreeLease,
  isLeaseExpired,
  listWorktreeLeases,
  reclaimOrphanedWorktrees,
  releaseWorktreeLease,
  renewWorktreeHeartbeat,
  symlinkDependencyCache,
  syncAndFastForwardWorktree,
} from "./worktree/index.ts";

export type {
  EpochMeshState,
  EpochMeshSyncResult,
  HealthIssue,
  HealthIssueType,
  HealthScoreMetrics,
  IgnitionOptions,
  IgnitionResult,
  MemorySnapshot,
  SelfHealingReport,
  TelemetryTrackAlphaState,
  TelemetryTrackBetaState,
  UniversalHealthReport,
} from "./telemetry/index.ts";

export {
  ALPHA_DEFAULT_CADENCE_MS,
  BETA_DEFAULT_CADENCE_MS,
  advanceEpoch,
  autoHealUniversalHealth,
  computeExecutionHealthScore,
  createEpochMesh,
  createTrackAlphaState,
  createTrackBetaState,
  diagnoseUniversalHealth,
  igniteSwarmEcosystem,
  recordAlphaHeartbeat,
  recordBetaRound,
  syncTrackAlphaAndBeta,
} from "./telemetry/index.ts";
