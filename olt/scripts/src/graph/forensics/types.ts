export interface ForensicTaskNode {
  readonly id: string;
  readonly label?: string | undefined;
  readonly effort?: number | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly resourceScope?: readonly string[] | undefined;
  readonly status?: string | undefined;
  readonly priority?: number | undefined;
  readonly gate?: string | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly depReasons?: Readonly<Record<string, string>> | undefined;
}

export interface DependencyEdge {
  readonly source: string;
  readonly target: string;
  readonly type?: string | undefined;
  readonly justification?: string | undefined;
  readonly reason?: string | undefined;
}

export interface CycleBreakCandidate {
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly edgeDescription: string;
  readonly rationale: string;
  readonly cycle: readonly string[];
}

export interface BrentsBoundResult {
  readonly processorCount: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly estimatedTime: number;
  readonly theoreticalDuration?: number;
  readonly speedup?: number;
  readonly theoreticalSpeedup: number;
  readonly efficiency?: number;
  readonly theoreticalEfficiency: number;
}

export interface CriticalPathDrag {
  readonly taskId: string;
  readonly effort: number;
  readonly isCritical: boolean;
  readonly drag: number;
  readonly dragPercentage: number;
  readonly dragCostSummary: string;
}

export interface FanOutBottleneck {
  readonly taskId: string;
  readonly fanOutCount: number;
  readonly downstreamTaskIds: readonly string[];
  readonly blockedEffort: number;
  readonly isCritical: boolean;
  readonly severity: "high" | "medium" | "low";
  readonly impactDescription: string;
}

export interface QueueStallAnalysis {
  readonly blockedTaskId: string;
  readonly blockerTaskId: string;
  readonly stallDuration: number;
  readonly writeScopeDisjoint: boolean;
  readonly isDataflowJustified: boolean;
  readonly depReason: string | undefined;
  readonly isCriticalStall: boolean;
  readonly recommendation: string;
}

export interface WorkSpanMetrics {
  readonly totalWork: number;
  readonly criticalSpan: number;
  readonly parallelismFactor: number;
  readonly optimalLanes: number;
  readonly maxSupportedLanes: number;
  readonly criticalPath: readonly string[];
  readonly brentsBounds: readonly BrentsBoundResult[];
  readonly drags: readonly CriticalPathDrag[];
  readonly fanOutBottlenecks: readonly FanOutBottleneck[];
  readonly queueStalls: readonly QueueStallAnalysis[];
}

export interface TaskSlack {
  readonly taskId: string;
  readonly effort: number;
  readonly earliestStartTime: number;
  readonly earliestFinishTime: number;
  readonly latestStartTime: number;
  readonly latestFinishTime: number;
  readonly totalSlack: number;
  readonly freeSlack: number;
  readonly isCritical: boolean;
}

export interface ForensicWave {
  readonly waveIndex: number;
  readonly taskIds: readonly string[];
  readonly totalWaveEffort: number;
  readonly maxLaneConcurrency: number;
  readonly hasScopeConflicts: boolean;
}

export interface ParallelLaneAssignment {
  readonly laneIndex: number;
  readonly taskId: string;
  readonly waveIndex: number;
  readonly earliestStartTime?: number | undefined;
  readonly earliestFinishTime?: number | undefined;
}

export interface ArtificialSerializationWarning {
  readonly code: "ARTIFICIAL_SERIALIZATION_WARNING";
  readonly blockedTask: string;
  readonly dependencyTask: string;
  readonly message: string;
  readonly dataflowJustified: boolean;
  readonly sourceScope: readonly string[];
  readonly targetScope: readonly string[];
}
