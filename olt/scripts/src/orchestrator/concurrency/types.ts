import type { BrentConcurrencyPlan, BrentPartition } from "../../mind/preplanning/types.ts";

export type { BrentConcurrencyPlan, BrentPartition };

export interface BrentDecompositionOptions {
  readonly workUnits: number;
  readonly spanLength?: number | undefined;
  readonly minParallelism?: number | undefined;
  readonly maxParallelism?: number | undefined;
  readonly scopeFiles?: readonly string[] | undefined;
  readonly parentTaskId?: string | undefined;
  readonly targetDurationSeconds?: number | undefined;
}

export interface RebalanceStragglerOptions {
  readonly minParallelism?: number | undefined;
  readonly maxParallelism?: number | undefined;
  readonly targetDurationSeconds?: number | undefined;
  readonly slaThresholdSeconds?: number | undefined;
}

export interface StragglingTask {
  readonly id: string;
  readonly agent_id?: string | undefined;
  readonly scope_files?: readonly string[] | undefined;
  readonly work_units?: number | undefined;
  readonly span_length?: number | undefined;
  readonly started_at?: number | string | undefined;
  readonly elapsed_seconds?: number | undefined;
}

export interface RebalancedTaskPackage {
  readonly original_task_id: string;
  readonly decomposition_plan: BrentConcurrencyPlan;
  readonly rebalanced_at: string;
  readonly spawned_subtasks: readonly {
    readonly subtask_id: string;
    readonly assigned_scope: readonly string[];
    readonly target_duration_seconds: number;
    readonly priority: "HIGH_STRAGGLER_REBALANCE";
  }[];
}

export interface StragglerPartitionReport {
  readonly onScheduleTasks: readonly string[];
  readonly stragglerTasks: readonly string[];
  readonly partitionedAt: string;
  readonly slaThresholdSeconds: number;
  readonly rebalancedPackages: readonly RebalancedTaskPackage[];
}

export interface FalseSerializationViolation {
  readonly taskIdA: string;
  readonly taskIdB: string;
  readonly reason: string;
  readonly remedy: string;
}

export interface FalseSerializationReport {
  readonly detected: boolean;
  readonly violations: readonly FalseSerializationViolation[];
  readonly checkedTaskPairsCount: number;
  readonly diagnostics: readonly string[];
}
