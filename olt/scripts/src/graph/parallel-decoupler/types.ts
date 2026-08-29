import type { ConcurrencyWave } from "../scope-analyzer.ts";

export const ARTIFICIAL_SERIALIZATION_WARNING = "ARTIFICIAL_SERIALIZATION_WARNING" as const;
export const FALSE_SERIALIZATION_DEFECT = "FALSE_SERIALIZATION_DEFECT" as const;
export const MAX_LANES_PER_COORDINATOR = 5 as const;
export const FAST_PATH_TASK_COUNT = 1 as const;

export interface ArtificialSerializationWarning {
  readonly code: typeof ARTIFICIAL_SERIALIZATION_WARNING;
  readonly blockedTask: string;
  readonly dependencyTask: string;
  readonly message: string;
  readonly dataflowJustified: boolean;
  readonly sourceScope: readonly string[];
  readonly targetScope: readonly string[];
}

export interface ParallelMetrics {
  readonly totalWork: number;
  readonly criticalSpan: number;
  readonly parallelismFactor: number;
  readonly optimalLanes: number;
  readonly maxSupportedLanes: number;
  readonly efficiency: number;
}

export interface ParallelLaneAssignment {
  readonly laneIndex: number;
  readonly taskId: string;
  readonly waveIndex: number;
}

export interface DecoupleOptions {
  readonly maxLanes?: number;
  readonly defaultEffort?: number;
  readonly preserveJustified?: boolean;
}

export interface DecoupledGraphResult {
  readonly graph: Record<string, unknown>;
  readonly decoupledEdges: readonly { readonly source: string; readonly target: string }[];
  readonly warnings: readonly ArtificialSerializationWarning[];
  readonly metrics: ParallelMetrics;
  readonly waves: readonly ConcurrencyWave[];
  readonly lanes: readonly ParallelLaneAssignment[];
}

export interface ParsedTaskInfo {
  readonly id: string;
  readonly writeScope: readonly string[];
  readonly effort: number;
  readonly status: string;
  readonly depReasons: Readonly<Record<string, string>>;
  readonly rawNode: Record<string, unknown>;
}

export interface ParsedEdgeInfo {
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly justification: string | undefined;
  readonly rawEdge: Record<string, unknown>;
}

export interface DynamicLanePartitioningResult {
  readonly lanes: readonly ParallelLaneAssignment[];
  readonly metrics: ParallelMetrics;
  readonly optimalLanes: number;
  readonly waves: readonly ConcurrencyWave[];
}

export type DynamicLaneTaskInput = {
  readonly id?: string | undefined;
  readonly taskId?: string | undefined;
  readonly effort?: number | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly wave?: number | undefined;
};

export type HierarchyScalingPath =
  | "fast_path_compaction"
  | "standard_coordinator"
  | "multi_coordinator_expansion";

export interface HierarchyScalingResult {
  readonly path: HierarchyScalingPath;
  readonly fastPath: boolean;
  readonly isMultiCoordinator: boolean;
  readonly requiredCoordinators: number;
  readonly maxLanesPerCoordinator: number;
  readonly optimalLanes: number;
  readonly reason: string;
}

export interface CoordinatorPartition {
  readonly coordinatorId: string;
  readonly coordinatorName: string;
  readonly domainOrStack: string;
  readonly taskIds: readonly string[];
  readonly laneIndices: readonly number[];
  readonly writeScope: readonly string[];
}

export interface MultiCoordinatorWavePartitionResult {
  readonly waveIndex: number;
  readonly totalLanes: number;
  readonly coordinatorCount: number;
  readonly partitions: readonly CoordinatorPartition[];
  readonly isMultiCoordinator: boolean;
  readonly summary: string;
}

export interface MultiCoordinatorPartitionOptions {
  readonly maxLanesPerCoordinator?: number | undefined;
  readonly waveIndex?: number | undefined;
  readonly stackPartitioning?: boolean | undefined;
  readonly domainHints?: Readonly<Record<string, string>> | undefined;
}

export interface AntiSerializationInterlockResult {
  readonly passed: boolean;
  readonly readyLanesCount: number;
  readonly dispatchedCount: number;
  readonly violation?:
    | {
        readonly code: typeof FALSE_SERIALIZATION_DEFECT;
        readonly message: string;
        readonly readyTaskIds: readonly string[];
        readonly recommendedDispatchArray: readonly SubagentDispatchItem[];
      }
    | undefined;
}

export interface SubagentDispatchItem {
  readonly TypeName: string;
  readonly Role: string;
  readonly Prompt: string;
  readonly Workspace: string;
  readonly [key: string]: unknown;
}

export interface SubagentDispatchFormatOptions {
  readonly defaultTypeName?: string | undefined;
  readonly defaultWorkspace?: string | undefined;
  readonly rolePrefix?: string | undefined;
  readonly basePromptTemplate?: string | undefined;
}
