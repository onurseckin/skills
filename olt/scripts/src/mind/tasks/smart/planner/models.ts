import type {
  ExactFileAnchor,
  ExactAnchorBriefing,
  SmartTaskSourceType,
  MacroMetrics,
  CoordinatorPartition,
  HierarchyScalingResult,
  MultiCoordinatorWavePartitionResult,
} from "./types.ts";
import type { TaskPriority, TaskQueueItem, TaskQueueStats } from "../../../../task/queue/index.ts";
import type {
  FeedbackItem,
  FeedbackPriority,
  FeedbackCategory,
} from "../../../feedback/queue/index.ts";

export interface SmartTaskPlan {
  readonly id: string;
  readonly label: string;
  readonly write_scope: readonly string[];
  readonly target_files?: readonly string[] | undefined;
  readonly exact_anchors?: readonly ExactFileAnchor[] | undefined;
  readonly exact_briefing?: ExactAnchorBriefing | undefined;
  readonly gate: string;
  readonly charter_goals: readonly string[];
  readonly acceptance_criteria: readonly string[];
  readonly dependencies: readonly string[];
  readonly source_type: SmartTaskSourceType;
  readonly priority?: TaskPriority | undefined;
  readonly effort?: number | undefined;
  readonly rationale: string;
  readonly assigned_tier?:
    | "Tier_0_Mind"
    | "Tier_1_Orchestrator"
    | "Tier_2_Coordinator"
    | "Tier_3_Implementer"
    | "Tier_3_Validator"
    | undefined;
  readonly assigned_role?: string | undefined;
  readonly assigned_implementer?: string | undefined;
  readonly assigned_validator?: string | undefined;
  readonly feedback_id?: string | undefined;
  readonly candidate_id?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AntiBatchingValidationReport {
  readonly compliant: boolean;
  readonly violations: readonly string[];
  readonly total_tasks: number;
  readonly isolated_task_count: number;
}

export interface SmartTaskSynthesisResult {
  readonly mode: "feedback_intake" | "self_evolution" | "external_intake" | "queue_active";
  readonly tasks: readonly SmartTaskPlan[];
  readonly summary: string;
  readonly source_items_count: number;
  readonly enqueued_count?: number | undefined;
  readonly anti_batching_enforced?: boolean | undefined;
  readonly hierarchy_scaling?: HierarchyScalingResult | undefined;
  readonly fast_path_compaction?: boolean | undefined;
}

export interface WaveGroup {
  readonly wave_number: number;
  readonly task_ids: readonly string[];
  readonly tasks: readonly SmartTaskPlan[];
  readonly coordinator_partitions?: readonly CoordinatorPartition[] | undefined;
}

export interface SmartWavePlanResult {
  readonly total_waves: number;
  readonly total_tasks: number;
  readonly waves: readonly WaveGroup[];
  readonly macro_metrics?: MacroMetrics | undefined;
  readonly optimal_lanes?: number | undefined;
  readonly hierarchy_scaling?: HierarchyScalingResult | undefined;
  readonly fast_path_compaction?: boolean | undefined;
  readonly multi_coordinator_partitions?:
    | readonly MultiCoordinatorWavePartitionResult[]
    | undefined;
}

export interface RebalancedTaskPlanResult extends SmartWavePlanResult {
  readonly macro_metrics: MacroMetrics;
  readonly optimal_lanes: number;
  readonly decoupled_edges_count: number;
  readonly warnings: readonly string[];
}

export interface ScopeCollision {
  readonly scope: string;
  readonly task_ids: readonly string[];
}

export interface MultiOrchestratorSubTreePlan {
  readonly orchestrator_id: string;
  readonly write_scope: readonly string[];
  readonly tasks: readonly SmartTaskPlan[];
  readonly wave_plan: SmartWavePlanResult;
  readonly macro_metrics: MacroMetrics;
  readonly coordinator_partitions?: readonly CoordinatorPartition[] | undefined;
}

export interface MultiOrchestratorPrePlanningResult {
  readonly total_orchestrators: number;
  readonly total_tasks: number;
  readonly orchestrators: readonly MultiOrchestratorSubTreePlan[];
  readonly macro_metrics: MacroMetrics;
  readonly is_disjoint: boolean;
  readonly cross_orchestrator_collisions: readonly ScopeCollision[];
  readonly warnings: readonly string[];
  readonly hierarchy_scaling?: HierarchyScalingResult | undefined;
  readonly total_coordinators?: number | undefined;
}

export interface MultiOrchestratorPlanningOptions {
  readonly orchestratorIds?: readonly string[] | undefined;
  readonly maxOrchestrators?: number | undefined;
  readonly maxLanesPerOrchestrator?: number | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly autoUpdateMemory?: boolean | undefined;
  readonly cognitiveMemoryPath?: string | undefined;
}

export type ProductOwnerIntakeStream =
  | "user_feedback"
  | "self_evolution"
  | "defect_candidate"
  | "charter_roadmap"
  | "direct_directive";

export interface ProductOwnerIntakeItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority?: TaskPriority | FeedbackPriority | undefined;
  readonly category?: FeedbackCategory | string | undefined;
  readonly stream: ProductOwnerIntakeStream;
  readonly candidate_id?: string | undefined;
  readonly charter_goals?: readonly string[] | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly gate?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ProductOwnerIntakeDecision {
  readonly item_id: string;
  readonly admitted: boolean;
  readonly priority: TaskPriority;
  readonly rationale: string;
  readonly assigned_task_id?: string | undefined;
  readonly assigned_orchestrator?: string | undefined;
  readonly rejected_reason?: string | undefined;
}

export interface InfiniteProductOwnerState {
  readonly cycle_number: number;
  readonly last_cycle_at: string;
  readonly total_intake_items: number;
  readonly total_admitted_and_dispatched: number;
  readonly total_declined: number;
  readonly active_orchestrator_subtrees: number;
  readonly macro_metrics: MacroMetrics;
  readonly zero_paused_admitted_verified: boolean;
}

export interface InfiniteProductOwnerResult {
  readonly cycle_id: string;
  readonly timestamp: string;
  readonly mode:
    | "feedback_intake"
    | "self_evolution"
    | "multi_orchestrator_dispatch"
    | "idle_monitored";
  readonly decisions: readonly ProductOwnerIntakeDecision[];
  readonly synthesized_tasks: readonly SmartTaskPlan[];
  readonly enqueued_tasks: readonly TaskQueueItem[];
  readonly multi_orchestrator_plan?: MultiOrchestratorPrePlanningResult | undefined;
  readonly macro_metrics: MacroMetrics;
  readonly zero_paused_admitted_guaranteed: boolean;
  readonly summary: string;
}

export interface AdmissionToDispatchAuditReport {
  readonly compliant: boolean;
  readonly total_feedback: number;
  readonly pending_feedback: number;
  readonly admitted_feedback: number;
  readonly paused_admitted_feedback: number;
  readonly total_tasks: number;
  readonly active_tasks: number;
  readonly zero_paused_admitted: boolean;
  readonly violations: readonly string[];
}

export interface AdmissionToDispatchResult {
  readonly synthesized_tasks: readonly SmartTaskPlan[];
  readonly enqueued_tasks: readonly TaskQueueItem[];
  readonly admitted_feedbacks: readonly FeedbackItem[];
  readonly audit_report: AdmissionToDispatchAuditReport;
  readonly summary: string;
}

export interface InfiniteProductOwnerOptions {
  readonly capsulesDir?: string | undefined;
  readonly queuePath?: string | undefined;
  readonly memoryPath?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly orchestratorCount?: number | undefined;
  readonly orchestratorIds?: readonly string[] | undefined;
  readonly maxTasks?: number | undefined;
  readonly directIntakeItems?: readonly ProductOwnerIntakeItem[] | undefined;
  readonly autoEnqueue?: boolean | undefined;
}

export interface AutonomousDualIntakeResult {
  readonly mode: "Mode_A_Self_Evolution" | "Mode_B_External_Intake" | "Queue_Active";
  readonly synthesized_plans: readonly SmartTaskPlan[];
  readonly enqueued_tasks: readonly TaskQueueItem[];
  readonly queue_stats: TaskQueueStats;
  readonly summary: string;
  readonly admitted_feedback_ids: readonly string[];
}

/**
 * Helper to extract target files from task write scope or explicit target files.
 */
