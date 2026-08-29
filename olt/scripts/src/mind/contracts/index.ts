/**
 * Mind Leaf Contracts Facade
 */

export type {
  DefectSeverity,
  DefectStatus,
  DefectType,
  DefectCurationClass,
  DefectCuration,
  DefectContext,
  DefectResolutionProof,
  DefectEntry,
  AggregatedDefect,
  DefectDiscriminatorOptions,
  DefectAggregateMetrics,
  EmpiricalFailureProof,
  SyncDoctorDefectOptions,
  SyncDefectResult,
} from "./defect-contracts.ts";

export type {
  TaskStatus,
  TaskPriority,
  SmartTaskStep,
  SmartTaskPlan,
  QueueItem,
  CompletedTaskRecord,
  TaskCandidate,
  TaskExecutionResult,
} from "./queue-contracts.ts";

export { VALID_PROPOSAL_TRANSITIONS } from "./proposal-contracts.ts";
export type {
  ProposalStatus,
  ProposalRecord,
  ProposalDecision,
  ProposalCandidate,
} from "./proposal-contracts.ts";

export type {
  DynamicRoleSpec,
  RoleBoundaryRule,
  RoleExecutionState,
} from "./role-contracts.ts";

export { ROOT_CAUSE_CATEGORIES } from "./audit-contracts.ts";
export type {
  RootCauseCategory,
  ForensicsIncident,
  ForensicsAnalysisResult,
  AuditorCursor,
  SkillAuditLiveResult,
} from "./audit-contracts.ts";

export type {
  MindMemoryEntry,
  CognitiveMemory,
  MemoryDigest,
  WakeBrief,
} from "./memory-contracts.ts";

export type {
  MindPulseStatus,
  GenerationGrant,
  MindBudgetOverrides,
  MindBudget,
  CharterConfig,
} from "./lifecycle-contracts.ts";

export type {
  GateEvaluation,
  CounterfactualHypothesis,
  QuiesceState,
} from "./gate-contracts.ts";
