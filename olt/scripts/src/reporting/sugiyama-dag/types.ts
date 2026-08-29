export interface SugiyamaNodeBadge {
  readonly implementerId?: string | undefined;
  readonly validatorId?: string | undefined;
  readonly coordinatorId?: string | undefined;
  readonly role?:
    | "implementer"
    | "validator"
    | "coordinator"
    | "observer"
    | "mind"
    | string
    | undefined;
  readonly effort?: number | undefined;
  readonly span?: number | undefined;
  readonly status?:
    | "pending"
    | "leased"
    | "running"
    | "validating"
    | "completed"
    | "failed"
    | string
    | undefined;
  readonly repairRound?: number | undefined;
  readonly probeRound?: number | undefined;
}

export interface SubagentNode {
  readonly id: string;
  readonly parentTaskId?: string | undefined;
  readonly role?: string | undefined;
  readonly status?: string | undefined;
  readonly label?: string | undefined;
  readonly assignedAgent?: string | null | undefined;
  readonly validatorAgent?: string | null | undefined;
  readonly validatorId?: string | null | undefined;
  readonly implementerAgent?: string | null | undefined;
  readonly writeScope?: readonly string[] | undefined;
}

export interface SugiyamaSubtask {
  readonly id: string;
  readonly label?: string | undefined;
  readonly status?: string | undefined;
  readonly assignedAgent?: string | null | undefined;
  readonly validatorAgent?: string | null | undefined;
  readonly validatorId?: string | null | undefined;
  readonly implementerAgent?: string | null | undefined;
  readonly role?: string | undefined;
  readonly coordinates?:
    | {
        readonly wave?: number;
        readonly lane?: number;
        readonly rank?: number;
        readonly order?: number;
      }
    | string
    | undefined;
  readonly writeScope?: readonly string[] | undefined;
}

export interface SugiyamaNode {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly dependencies: readonly string[];
  readonly writeScope?: readonly string[] | undefined;
  readonly resourceScope?: readonly string[] | undefined;
  readonly gate?: string | undefined;
  readonly assignedAgent?: string | null | undefined;
  readonly assignedRole?: string | null | undefined;
  readonly assignedTool?: string | null | undefined;
  readonly validatorAgent?: string | null | undefined;
  readonly validatorId?: string | null | undefined;
  readonly implementerAgent?: string | null | undefined;
  readonly attempt?: number | null | undefined;
  readonly priority?: number | undefined;
  readonly effort?: number | undefined;
  readonly criticalDepth?: number | undefined;
  readonly descendantCount?: number | undefined;
  readonly depReasons?: Readonly<Record<string, string>> | undefined;
  readonly isDummy?: boolean | undefined;
  readonly origSource?: string | undefined;
  readonly origTarget?: string | undefined;
  readonly coordinates?:
    | {
        readonly wave?: number;
        readonly lane?: number;
        readonly rank?: number;
        readonly order?: number;
      }
    | string
    | undefined;
  readonly wave?: number | undefined;
  readonly lane?: number | undefined;
  readonly parentTaskId?: string | undefined;
  readonly branchId?: string | undefined;
  readonly round?: number | undefined;
  readonly probeRound?: number | undefined;
  readonly expandedSubtasks?: readonly (SugiyamaNode | SugiyamaSubtask | string)[] | undefined;
  readonly dynamicOrigin?:
    | "static"
    | "dynamic_expansion"
    | "branch"
    | "replan"
    | "repair_branch"
    | undefined;
  readonly pushes?: number | undefined;
  readonly probes?: number | undefined;
  readonly inLeaseRepairs?: number | undefined;
  readonly coordinatorId?: string | undefined;
  readonly coordinatorOwnershipPct?: number | undefined;
  readonly activeLeaseTimerSeconds?: number | undefined;
  readonly badge?: SugiyamaNodeBadge | undefined;
}

export interface SugiyamaEdge {
  readonly from: string;
  readonly to: string;
  readonly type?:
    | "dataflow"
    | "scope_conflict"
    | "explicit_justification"
    | "prerequisite_gate"
    | "declared_dep"
    | "virtual"
    | undefined;
  readonly reason?: string | undefined;
}

export interface DirectedGraph {
  readonly nodes: readonly SugiyamaNode[];
  readonly edges: readonly SugiyamaEdge[];
}

export interface SugiyamaDag {
  readonly nodes: readonly SugiyamaNode[];
  readonly edges: readonly SugiyamaEdge[];
}

export interface SugiyamaRankedNode extends SugiyamaNode {
  readonly rank: number;
  readonly order: number;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface SugiyamaLayer {
  readonly rank: number;
  readonly nodes: readonly SugiyamaRankedNode[];
}

export interface OrthogonalEdgeSegment {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly waypoints: readonly { readonly x: number; readonly y: number }[];
  readonly glyphType: "direct_down" | "fan_out_bus" | "fan_in_bus" | "cross_lane" | string;
}

export interface OrthogonalRouteSegment {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly fromWave: number;
  readonly toWave: number;
  readonly fromLane: number;
  readonly toLane: number;
}

export interface CycleDiagnostic {
  readonly hasCycle: boolean;
  readonly cyclePaths: readonly (readonly string[])[];
  readonly cycleEdges: readonly { readonly from: string; readonly to: string }[];
  readonly alert: string;
  readonly remediation: readonly string[];
  readonly cycleNodeIds: readonly string[];
}

export interface BypassDiagnosticItem {
  readonly from: string;
  readonly to: string;
  readonly intermediatePath: readonly string[];
  readonly reason: string;
}

export interface BypassDiagnostic {
  readonly hasBypass: boolean;
  readonly bypasses: readonly BypassDiagnosticItem[];
  readonly bypassEdges: readonly { readonly from: string; readonly to: string }[];
  readonly alert: string;
  readonly warnings: readonly string[];
}

export interface SugiyamaWaveMetrics {
  readonly totalWaves: number;
  readonly maxParallelLanes: number;
  readonly criticalPathLength: number;
  readonly averageWaveConcurrency: number;
  readonly serialBottlenecks: number;
  readonly parallelEligibleChains: number;
  readonly totalWork: number;
  readonly span: number;
  readonly parallelismFactor: number;
  readonly optimalConcurrency: number;
}

export interface SugiyamaRenderOptions {
  readonly detailed?: boolean | undefined;
  readonly boxStyle?: "rounded" | "sharp" | "ascii" | undefined;
  readonly minBoxWidth?: number | undefined;
  readonly showDiagnostics?: boolean | undefined;
  readonly showForensics?: boolean | undefined;
  readonly title?: string | undefined;
  readonly maxWidth?: number | undefined;
  readonly passes?: number | undefined;
}

export interface SugiyamaDagReport {
  readonly markdown: string;
  readonly renderedDag: string;
  readonly layers: readonly SugiyamaLayer[];
  readonly nodes: readonly SugiyamaRankedNode[];
  readonly cycleDiagnostic: CycleDiagnostic;
  readonly bypassDiagnostic: BypassDiagnostic;
  readonly metrics: SugiyamaWaveMetrics;
  readonly isCompiled: boolean;
  readonly graphRevision: number | null;
  readonly totalTasks: number;
  readonly totalNodes?: number | undefined;
  readonly totalLayers?: number | undefined;
  readonly maxLayerWidth?: number | undefined;
  readonly totalCrossings?: number | undefined;
  readonly renderedAscii?: string | undefined;
  readonly edges?: readonly OrthogonalEdgeSegment[] | undefined;
}

export interface DiagnosticHealthResult {
  readonly healthy: boolean;
  readonly issues: readonly string[];
  readonly cycleCount: number;
  readonly bypassCount: number;
}
