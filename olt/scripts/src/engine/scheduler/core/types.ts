import type { WatchdogRecord } from "../../../authority/watchdog-manager.ts";
import type { TaskStatus } from "../../../core/contracts/index.ts";
import type { Clock } from "../../../workflow/types.ts";

export interface GraphHealthIssue {
  readonly probe:
    | "orphaned_tasks"
    | "stale_leases"
    | "circular_dependencies"
    | "gate_coverage"
    | "scope_collisions";
  readonly severity: "critical" | "warning" | "info";
  readonly message: string;
  readonly entityIds: readonly string[];
}
export interface OrphanedTasksProbeResult {
  readonly passed: boolean;
  readonly orphanedTaskIds: readonly string[];
  readonly disconnectedTaskIds: readonly string[];
  readonly unmappedRequirementTaskIds: readonly string[];
  readonly details: readonly string[];
}
export interface StaleLeaseInfo {
  readonly taskId: string;
  readonly agentId: string;
  readonly role: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastHeartbeatAt: string;
  readonly durationSeconds: number;
  readonly overdueMs: number;
  readonly reason: "expired_timestamp" | "heartbeat_timeout";
}
export interface StaleLeasesProbeResult {
  readonly passed: boolean;
  readonly staleTaskIds: readonly string[];
  readonly staleLeases: readonly StaleLeaseInfo[];
  readonly details: readonly string[];
}
export interface CircularDependenciesProbeResult {
  readonly passed: boolean;
  readonly hasCycles: boolean;
  readonly cycles: readonly string[][];
  readonly cycleDescriptions: readonly string[];
  readonly details: readonly string[];
}
export interface GateCoverageProbeResult {
  readonly passed: boolean;
  readonly uncoveredRequirementIds: readonly string[];
  readonly tasksWithoutGateCoverage: readonly string[];
  readonly invalidGates: readonly string[];
  readonly hasMandatoryRunGate: boolean;
  readonly details: readonly string[];
}
export interface ScopeCollisionHazard {
  readonly leftTaskId: string;
  readonly rightTaskId: string;
  readonly conflictType: "write_scope" | "resource_scope" | "both";
  readonly writeScopeOverlap: boolean;
  readonly resourceScopeOverlap: boolean;
  readonly details: string;
}
export interface ScopeCollisionProbeResult {
  readonly passed: boolean;
  readonly activeCollisions: readonly ScopeCollisionHazard[];
  readonly candidateCollisions: readonly ScopeCollisionHazard[];
  readonly totalHazardCount: number;
  readonly details: readonly string[];
}
export interface GraphHealthAuditReport {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly totalTasks: number;
  readonly issues: readonly GraphHealthIssue[];
  readonly probes: {
    readonly orphanedTasks: OrphanedTasksProbeResult;
    readonly staleLeases: StaleLeasesProbeResult;
    readonly circularDependencies: CircularDependenciesProbeResult;
    readonly gateCoverageViolations: GateCoverageProbeResult;
    readonly scopeCollisionHazards: ScopeCollisionProbeResult;
  };
}
export interface SupervisoryWatchdogAuditReport {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly activeWatchdogsCount: number;
  readonly staleWatchdogsCount: number;
  readonly terminatedWatchdogsCount: number;
  readonly orphanedWatchdogsCount: number;
  readonly activeWatchdogs: readonly WatchdogRecord[];
  readonly overdueWatchdogs: readonly WatchdogRecord[];
  readonly hungAgentIds: readonly string[];
  readonly issues: readonly string[];
}
export interface WorkSpanHealthAudit {
  readonly passed: boolean;
  readonly workParallelismRatio: number;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly activeTasks: number;
  readonly readyTasks: number;
  readonly criticalPathLength: number;
  readonly activeBottlenecks: readonly string[];
  readonly dynamicTopologyWaveCount: number;
  readonly spanUtilizationRatio: number;
  readonly details: readonly string[];
}
export interface PlanEnhancementAudit {
  readonly passed: boolean;
  readonly totalRequirements: number;
  readonly unfulfilledRequirementsCount: number;
  readonly pendingCandidateCount: number;
  readonly needsReplanning: boolean;
  readonly suggestedEnhancements: readonly string[];
  readonly details: readonly string[];
}
export interface AgentRegistryAccuracyAudit {
  readonly passed: boolean;
  readonly totalRegistered: number;
  readonly totalActiveGrants: number;
  readonly totalActiveLeases: number;
  readonly accuracyPercentage: number;
  readonly unmappedLeaseAgents: readonly string[];
  readonly mismatchedRoleAgents: readonly string[];
  readonly ghostAgentIds: readonly string[];
  readonly details: readonly string[];
}
export interface RoleBoundaryAdherenceAudit {
  readonly passed: boolean;
  readonly hierarchicalViolations: readonly string[];
  readonly tierConfinementViolations: readonly string[];
  readonly details: readonly string[];
}
export interface DoctorErrorResolutionAudit {
  readonly passed: boolean;
  readonly totalIssues: number;
  readonly unresolvedErrors: readonly string[];
  readonly repairRecommendations: readonly string[];
  readonly details: readonly string[];
}
export interface SupervisoryTopLeader {
  readonly agentId: string;
  readonly role: "mind" | "orchestrator" | "coordinator";
  readonly tier: number;
}
export interface Supervisory5PointHealthReport {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly topLeader: SupervisoryTopLeader;
  readonly workSpanHealth: WorkSpanHealthAudit;
  readonly planEnhancement: PlanEnhancementAudit;
  readonly agentRegistryAccuracy: AgentRegistryAccuracyAudit;
  readonly roleBoundaryAdherence: RoleBoundaryAdherenceAudit;
  readonly doctorResolution: DoctorErrorResolutionAudit;
  readonly overallIssues: readonly string[];
  readonly markdown: string;
}
export interface SupervisoryProbeDispatchResult {
  readonly dispatched: boolean;
  readonly targetAgentId: string;
  readonly targetRole: string;
  readonly report: Supervisory5PointHealthReport;
  readonly promptForLeader: string;
  readonly markdown: string;
}
export interface Supervisory5PointOptions {
  readonly runRoot?: string | undefined;
  readonly now?: Date | string | number | undefined;
  readonly doctorResult?: Record<string, unknown> | undefined;
}
export interface TaskRecoveryRecord {
  readonly taskId: string;
  readonly fromStatus: TaskStatus;
  readonly toStatus: TaskStatus;
  readonly agentId: string | null;
  readonly reason: string;
  readonly attempt: number;
  readonly recoveredAt: string;
}
export interface TaskRecoveryResult {
  readonly recoveredCount: number;
  readonly recoveredTasks: readonly TaskRecoveryRecord[];
  readonly healthy: boolean;
  readonly details: readonly string[];
}
export interface ScheduledTaskDispatch {
  readonly taskId: string;
  readonly label: string | null;
  readonly priority: number;
  readonly writeScope: readonly string[];
  readonly resourceScope: readonly string[];
  readonly requirementIds: readonly string[];
  readonly wave?: number | null | undefined;
}
export interface BlockedTaskInfo {
  readonly taskId: string;
  readonly status: string;
  readonly blockingReason: string;
  readonly prerequisites: readonly string[];
  readonly unsatisfiedPrerequisites: readonly string[];
}
export interface ScheduledWaveResult {
  readonly readyTasks: readonly ScheduledTaskDispatch[];
  readonly blockedTasks: readonly BlockedTaskInfo[];
  readonly activeOccupiedTasks: readonly string[];
  readonly totalEligible: number;
  readonly maxParallel: number | null;
  readonly evaluatedAt: string;
}
export interface SchedulerEngineOptions {
  readonly maxParallel?: number | null | undefined;
  readonly timeoutMs?: number | undefined;
  readonly heartbeatCadenceMs?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly watchdogTarget?: string | undefined;
  readonly maxRepairRounds?: number | undefined;
}
