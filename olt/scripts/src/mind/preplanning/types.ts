export type BacklogItemStatus = "PENDING" | "PLANNED" | "DISPATCHED" | "PROCESSED" | "BLOCKED";
export type DefectStatus = "OPEN" | "PLANNED" | "IN_PROGRESS" | "RESOLVED" | "REOPENED";

export type DomainCategory = "core" | "validation" | "tooling" | "engine" | "mind" | "reporting";

export interface ThematicCluster {
  readonly cluster_id: string;
  readonly domain: DomainCategory;
  readonly title: string;
  readonly plan_path: string;
  readonly backlog_item_ids: readonly string[];
  readonly defect_ids: readonly string[];
  readonly planned_at: string;
  readonly description?: string | undefined;
}

export interface RawBacklogItem {
  readonly id: string;
  readonly title?: string | undefined;
  readonly content?: string | undefined;
  readonly priority?: string | undefined;
  readonly status?: string | BacklogItemStatus | undefined;
  readonly category?: string | undefined;
  readonly domain?: string | undefined;
  readonly plan_path?: string | null | undefined;
  readonly created_at?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly [key: string]: unknown;
}

export interface RawDefectItem {
  readonly id: string;
  readonly title?: string | undefined;
  readonly message?: string | undefined;
  readonly description?: string | undefined;
  readonly error_code?: string | undefined;
  readonly type?: string | undefined;
  readonly category?: string | undefined;
  readonly severity?: string | undefined;
  readonly status?: string | DefectStatus | undefined;
  readonly domain?: string | undefined;
  readonly plan_path?: string | null | undefined;
  readonly timestamp?: string | undefined;
  readonly first_seen?: string | undefined;
  readonly last_seen?: string | undefined;
  readonly [key: string]: unknown;
}

export interface ClusterOptions {
  readonly targetDir?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly minItemsPerCluster?: number | undefined;
  readonly maxItemsPerCluster?: number | undefined;
}

export type HostSchedulerId = "antigravity" | "claude_code" | "codex" | "cursor";
export type ThinkingLevel = "high" | "medium" | "low" | "none";

export interface HostSchedulerConfig {
  readonly host_id: HostSchedulerId;
  readonly default_cadence_seconds: number;
  readonly tier_0_2_model: string;
  readonly tier_0_2_thinking: ThinkingLevel;
  readonly tier_3_model: string;
  readonly tier_3_thinking: ThinkingLevel;
  readonly max_single_task_seconds: number;
  readonly heartbeat_tick_seconds: number;
  readonly watchdog_timeout_seconds: number;
}

export interface GitStagingInvariantRecord {
  readonly staging_id: string;
  readonly milestone_id: string;
  readonly subdomain: string;
  readonly staged_at: string;
  readonly staged_files: readonly string[];
  readonly git_index_sha: string;
  readonly blob_objects_written: number;
}

export interface BrentPartition {
  readonly subtask_id: string;
  readonly assigned_scope: readonly string[];
  readonly target_duration_seconds: number;
}

export interface BrentConcurrencyPlan {
  readonly active_workers: number;
  readonly remaining_work_units: number;
  readonly span_length: number;
  readonly optimal_parallelism: number;
  readonly estimated_subagent_duration_seconds: number;
  readonly sub_partitions: readonly BrentPartition[];
}

export interface StragglerAssessment {
  readonly task_id: string;
  readonly agent_id: string;
  readonly elapsed_seconds: number;
  readonly is_straggler: boolean;
  readonly recommended_action: "DECOMPOSE_PARALLEL" | "RECLAIM_LEASE" | "CONTINUE";
  readonly decomposition_plan?: BrentConcurrencyPlan | undefined;
}

export type AssemblyStationStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "VERIFIED"
  | "LANDED"
  | "FAILED"
  | "STRAGGLING";

export interface AssemblyStation {
  readonly station_id: string;
  readonly domain: DomainCategory;
  readonly milestone_id: string;
  readonly assigned_files: readonly string[];
  readonly status: AssemblyStationStatus;
  readonly claimed_at?: string | undefined;
  readonly verified_at?: string | undefined;
  readonly landed_at?: string | undefined;
  readonly staging_record?: GitStagingInvariantRecord | undefined;
}

export interface PreplanningRunResult {
  readonly clusters: readonly ThematicCluster[];
  readonly items_planned: number;
  readonly defects_planned: number;
  readonly plan_files_written: readonly string[];
  readonly started_at: string;
  readonly completed_at: string;
  readonly duration_ms: number;
}

export interface StagnationAuditResult {
  readonly is_stagnant: boolean;
  readonly pending_backlog_count: number;
  readonly open_defects_count: number;
  readonly last_preplan_timestamp: string | null;
  readonly idle_duration_seconds: number;
  readonly error_code?: "MIND_PREPLANNING_STAGNATION" | undefined;
  readonly findings: readonly string[];
  readonly recommended_remediation?: string | undefined;
}

export interface ConcurrencyAuditResult {
  readonly is_saturated: boolean;
  readonly active_workers: number;
  readonly optimal_concurrency: number;
  readonly saturation_ratio: number;
  readonly unstaged_stations: readonly string[];
  readonly straggling_tasks: readonly string[];
  readonly findings: readonly string[];
  readonly warnings: readonly string[];
}

export interface PlanGenerationOptions {
  readonly cluster: ThematicCluster;
  readonly targetSubsystems?: readonly string[] | undefined;
  readonly author?: string | undefined;
  readonly repoRoot?: string | undefined;
}

export interface MindAuditorStagnationReport {
  readonly isStagnant: boolean;
  readonly unclusteredBacklogCount: number;
  readonly unclusteredDefectCount: number;
  readonly idleDurationSeconds: number;
  readonly violationCode?: "MIND_PREPLANNING_STAGNATION" | undefined;
}
