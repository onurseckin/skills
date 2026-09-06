/**
 * Types for the Cross-System Monitoring Surface.
 * Strictly immutable data structures for visualizing system liveness, roster,
 * obligations, run state, shared metrics, drift, and overall system health.
 */

export type LivenessStatus = "ALIVE" | "DEGRADED" | "UNREACHABLE" | "FREEZE";

export interface SystemLivenessInfo {
  readonly systemId: string;
  readonly lastHeartbeatTimestamp: string;
  readonly ageSeconds: number;
  readonly declaredIntervalSeconds: number;
  readonly consecutiveMissedBeats: number;
  readonly status: LivenessStatus;
  readonly statusMessage: string;
  readonly activeRunIds: readonly string[];
}

export type AgentRoleType =
  | "liaison"
  | "orchestrator"
  | "coordinator"
  | "implementer"
  | "validator"
  | "critic"
  | "auditor"
  | "unknown";

export type AgentExecutionStatus = "active" | "idle" | "stalled" | "completed";

export interface AgentIdentityInfo {
  readonly agentId: string;
  readonly roleType: AgentRoleType;
  readonly laneId?: string | undefined;
  readonly status: AgentExecutionStatus;
  readonly lastActiveTimestamp?: string | undefined;
}

export interface SystemRosterMetrics {
  readonly activeAgents: readonly AgentIdentityInfo[];
  readonly totalActiveAgents: number;
  readonly implementerCount: number;
  readonly distinctImplementers: number;
  readonly distinctImplementerIdentities: readonly string[];
  readonly laneCount: number;
  readonly lanesPerImplementerRatio: number;
  readonly isSerialExecutionRisk: boolean;
  readonly serialExecutionWarning: string | null;
}

export type BindingState = "delivered" | "bound" | "refused" | "overdue";

export interface ObligationDirective {
  readonly directiveId: string;
  readonly correlationId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly timestamp: string;
  readonly description: string;
  readonly namedPaths: readonly string[];
  readonly overdueWindowSeconds: number;
}

export interface ObligationBindingProof {
  readonly runId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly boundScopePaths?: readonly string[] | undefined;
  readonly artifactPath?: string | undefined;
  readonly commitHash?: string | undefined;
}

export interface ObligationStateItem {
  readonly directive: ObligationDirective;
  readonly bindingState: BindingState;
  readonly deliveredAt: string | null;
  readonly boundAt: string | null;
  readonly proof: ObligationBindingProof | null;
  readonly refusalReason: string | null;
  readonly isOverdue: boolean;
  readonly elapsedSeconds: number;
}

export interface SystemObligationSummary {
  readonly obligations: readonly ObligationStateItem[];
  readonly totalObligations: number;
  readonly openCount: number;
  readonly boundCount: number;
  readonly refusedCount: number;
  readonly overdueCount: number;
}

export type LaneLifecycleStatus =
  | "ready"
  | "claimed"
  | "running"
  | "validating"
  | "completed"
  | "failed";

export interface LaneStateInfo {
  readonly laneId: string;
  readonly status: LaneLifecycleStatus;
  readonly leaseHolder: string | null;
  readonly writeScope: readonly string[];
  readonly claimedAt?: string | undefined;
}

export interface SystemRunStateInfo {
  readonly runId: string;
  readonly status: string;
  readonly lanes: readonly LaneStateInfo[];
  readonly unclaimedReadyLanes: readonly string[];
  readonly activeLeaseHolders: readonly string[];
  readonly totalLanes: number;
}

export interface SharedMetricItem {
  readonly name: string;
  readonly value: number | string | boolean;
  readonly unit?: string | undefined;
  readonly computationDefinition: string;
  readonly computedAt: string;
  readonly authority: string;
}

export type DriftDirection = "improved" | "regressed" | "neutral";

export interface DriftItem {
  readonly metricName: string;
  readonly baselineValue: number;
  readonly currentValue: number;
  readonly delta: number;
  readonly direction: DriftDirection;
  readonly isRegression: boolean;
  readonly threshold?: number | undefined;
  readonly absorbedRegressionAllowed: boolean;
}

export type OverallHealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "CRITICAL";

export interface SystemHealthSummary {
  readonly status: OverallHealthStatus;
  readonly healthScore: number;
  readonly reasons: readonly string[];
  readonly concerns: readonly string[];
  readonly recommendations: readonly string[];
  readonly isWorkingWell: boolean;
}

export interface MonitoringSnapshot {
  readonly snapshotId: string;
  readonly timestamp: string;
  readonly systemId: string;
  readonly peerSystemId?: string | undefined;
  readonly liveness: SystemLivenessInfo;
  readonly roster: SystemRosterMetrics;
  readonly obligations: SystemObligationSummary;
  readonly runState: SystemRunStateInfo | null;
  readonly sharedMetrics: readonly SharedMetricItem[];
  readonly drift: readonly DriftItem[];
  readonly health: SystemHealthSummary;
}

export type RenderFormat = "cli" | "markdown" | "json";

export interface RenderOptions {
  readonly format?: RenderFormat | undefined;
  readonly includeAnsiColors?: boolean | undefined;
  readonly compact?: boolean | undefined;
  readonly now?: string | undefined;
}
