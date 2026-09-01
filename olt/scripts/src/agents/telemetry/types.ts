export const ALPHA_DEFAULT_CADENCE_MS = 15 * 60 * 1000;
export const BETA_DEFAULT_CADENCE_MS = 60 * 60 * 1000;

export interface MemorySnapshot {
  readonly id: string;
  readonly timestamp: number;
  readonly summary: string;
}

export interface TelemetryTrackAlphaState {
  readonly agentId: string;
  readonly lastHeartbeat: number;
  readonly cadenceMs: number;
  readonly healthScore: number;
  readonly memorySupersessionDepth: number;
  readonly memorySnapshots: readonly MemorySnapshot[];
  readonly stagnationRisk: "nominal" | "warning" | "critical";
}

export interface HealthScoreMetrics {
  readonly toolErrors: number;
  readonly stagnationSeconds: number;
  readonly memorySupersessionDepth: number;
  readonly leaseUtilizationRatio: number;
}

export interface TelemetryTrackBetaState {
  readonly epochId: string;
  readonly round: number;
  readonly maxRounds: number;
  readonly cadenceMs: number;
  readonly convergenceScore: number;
  readonly strategicAnchors: readonly string[];
  readonly status: "deliberating" | "converged" | "re_anchoring" | "completed";
}

export interface EpochMeshState {
  readonly epochId: string;
  readonly currentRound: number;
  readonly activeAlphaAgents: readonly string[];
  readonly globalHealthScore: number;
  readonly isSynchronized: boolean;
  readonly lastMeshSyncAt: number;
}

export interface EpochMeshSyncResult {
  readonly nextMeshState: EpochMeshState;
  readonly converged: boolean;
  readonly activeAlphaCount: number;
  readonly averageHealthScore: number;
}

export type HealthIssueType =
  | "stale_mailbox_lock"
  | "orphaned_worktree"
  | "dangling_browser"
  | "expired_write_lease";

export interface HealthIssue {
  readonly type: HealthIssueType;
  readonly target: string;
  readonly description: string;
  readonly severity: "warning" | "critical";
}

export interface UniversalHealthReport {
  readonly healthy: boolean;
  readonly timestamp: number;
  readonly issues: readonly HealthIssue[];
  readonly stats: {
    readonly staleLocks: number;
    readonly orphanedWorktrees: number;
    readonly danglingBrowsers: number;
    readonly expiredLeases: number;
  };
}

export interface SelfHealingReport {
  readonly healed: boolean;
  readonly timestamp: number;
  readonly actionsTaken: readonly string[];
  readonly remainingIssues: readonly HealthIssue[];
}

export interface IgnitionOptions {
  readonly workspaceRoot?: string;
  readonly initialEpochId?: string;
  readonly autoHeal?: boolean;
}

export interface IgnitionResult {
  readonly ready: boolean;
  readonly workspaceRoot: string;
  readonly createdDirectories: readonly string[];
  readonly healthReport: UniversalHealthReport;
  readonly selfHealingReport: SelfHealingReport;
  readonly registeredAgentsCount: number;
  readonly epochMesh: EpochMeshState;
  readonly message: string;
}
