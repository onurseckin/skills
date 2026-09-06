export interface DagTaskNode {
  readonly id: string;
  readonly label?: string;
  readonly dependencies: readonly string[];
  readonly writeScope?: readonly string[];
  readonly effort?: number;
  readonly status?: string;
}

export interface DagEdge {
  readonly from: string;
  readonly to: string;
}

export interface TarjanSccResult {
  readonly acyclic: boolean;
  readonly sccs: readonly (readonly string[])[];
  readonly cycles: readonly (readonly string[])[];
  readonly feedbackArcs: readonly DagEdge[];
}

export interface ScopeOverlapFinding {
  readonly taskA: string;
  readonly taskB: string;
  readonly scopeA: string;
  readonly scopeB: string;
  readonly overlapPath: string;
}

export interface BrentAnalysisResult {
  readonly totalWork: number;
  readonly criticalSpan: number;
  readonly recommendedProcessors: number;
  readonly lowerBoundTime: number;
  readonly upperBoundTime: number;
  readonly theoreticalSpeedup: number;
  readonly theoreticalEfficiency: number;
}

export interface ArtificialSerializationEdge {
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly reason: string;
  readonly canDecouple: boolean;
}

export interface DagCheckResult {
  readonly ok: boolean;
  readonly taskCount: number;
  readonly edgeCount: number;
  readonly cycles: TarjanSccResult;
  readonly scopeAudits: readonly ScopeOverlapFinding[];
  readonly brent: BrentAnalysisResult;
  readonly artificialEdges: readonly ArtificialSerializationEdge[];
}

export interface DagHealOptions {
  readonly mode?: "prune" | "invert";
  readonly lockPath?: string;
  readonly dryRun?: boolean;
}

export interface DagHealResult {
  readonly healed: boolean;
  readonly actionsTaken: readonly string[];
  readonly removedEdges: readonly DagEdge[];
  readonly invertedEdges: readonly DagEdge[];
  readonly healedTasks: readonly DagTaskNode[];
  readonly waves: readonly (readonly string[])[];
}
