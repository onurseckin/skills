import type { ConcurrencyWave } from "../scope-analyzer.ts";

export type DynamicTaskOrigin =
  | "static"
  | "dynamic_expansion"
  | "branch"
  | "replan"
  | "repair_branch";

export interface DynamicTaskState {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly role?: string | undefined;
  readonly dependencies: readonly string[];
  readonly writeScope: readonly string[];
  readonly assignedAgent?: string | null | undefined;
  readonly origin: DynamicTaskOrigin;
  readonly createdAtSeq: number;
  readonly updatedAtSeq: number;
  readonly branchId?: string | undefined;
  readonly round: number;
  readonly attempt: number;
  readonly executionState: string;
  readonly activeTool?: string | null | undefined;
  readonly activeCommand?: string | null | undefined;
  readonly activeStepIndex?: number | null | undefined;
  readonly rejectionReason?: string | null | undefined;
  readonly validatorId?: string | null | undefined;
  readonly repairForTaskId?: string | null | undefined;
  readonly findings?: readonly string[] | undefined;
}

export interface ActiveAgentState {
  readonly agentId: string;
  readonly role: string;
  readonly currentTaskId: string | null;
  readonly lastActiveSeq: number;
  readonly lastActiveTimestamp?: string | undefined;
}

export interface DynamicDagState {
  readonly revision: number;
  readonly totalEvents: number;
  readonly tasks: readonly DynamicTaskState[];
  readonly activeAgents: readonly ActiveAgentState[];
  readonly waves: readonly ConcurrencyWave[];
  readonly criticalPath: readonly string[];
  readonly executionSummary: {
    readonly totalTasks: number;
    readonly readyTasks: number;
    readonly leasedTasks: number;
    readonly submittedTasks: number;
    readonly validatingTasks: number;
    readonly doneTasks: number;
    readonly failedTasks: number;
    readonly totalBranches: number;
    readonly activeAgentsCount: number;
  };
}

export interface DagCriticalPathResult {
  readonly criticalPath: readonly string[];
  readonly totalEffort: number;
  readonly longestChainLength: number;
}

export interface ConcurrencyMetricsResult {
  readonly maxParallelism: number;
  readonly totalTasks: number;
  readonly totalWaves: number;
  readonly laneUtilization: number;
  readonly averageWaveConcurrency: number;
  readonly theoreticalSpeedup: number;
}

export interface ReplanFindingInput {
  readonly id: string;
  readonly severity: "critical" | "important" | "minor";
  readonly observation: string;
  readonly remediation: string;
  readonly filePaths?: readonly string[] | undefined;
  readonly revalidationGate?: string | undefined;
}

export interface ReplanFromFindingsInput {
  readonly graphDocument: Record<string, unknown>;
  readonly findings: readonly ReplanFindingInput[];
  readonly fallbackGate: string | readonly string[];
  readonly actor?: string | undefined;
  readonly round?: number | undefined;
}

export interface ReplanFromFindingsResult {
  readonly success: boolean;
  readonly graphDocument: Record<string, unknown>;
  readonly newRevision: number;
  readonly addedRepairTasks: readonly Record<string, unknown>[];
  readonly pairedValidators: readonly Record<string, unknown>[];
  readonly partitionedScopes: readonly (readonly string[])[];
}
