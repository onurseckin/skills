import type {
  CognitivePillar,
  CognitivePillarId,
  SupervisoryRole,
} from "../pillars.ts";

export type { CognitivePillar, CognitivePillarId, SupervisoryRole };

export interface RoleBoundaryProfile {
  readonly role: SupervisoryRole;
  readonly tier: number;
  readonly tierName: string;
  readonly archetype: string;
  readonly coreMandate: string;
  readonly permittedSpawns: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly mandatoryCadence: {
    readonly heartbeatCadenceMs: number;
    readonly supervisoryScheduleCron: string;
    readonly supervisoryScheduleMinutes: number;
  };
  readonly roleInvariants: readonly string[];
  readonly reflexiveQuestions: readonly string[];
}

export interface WatchdogPersonaGroundingOptions {
  readonly role: SupervisoryRole | string;
  readonly tickNumber?: number | undefined;
  readonly startedAt?: string | number | Date | undefined;
  readonly now?: string | number | Date | undefined;
  readonly cadenceMs?: number | undefined;
  readonly runId?: string | null | undefined;
  readonly pulseId?: string | null | undefined;
  readonly activeLeaseCount?: number | undefined;
  readonly openFindingCount?: number | undefined;
  readonly queueReadyCount?: number | undefined;
}

export interface WatchdogGroundingInjection {
  readonly id: string;
  readonly role: SupervisoryRole;
  readonly tier: number;
  readonly tickNumber: number;
  readonly timestamp: string;
  readonly cadenceMs: number;
  readonly elapsedMs: number;
  readonly runId: string | null;
  readonly pulseId: string | null;
  readonly pillars: readonly CognitivePillar[];
  readonly roleBoundaries: RoleBoundaryProfile;
  readonly reflexiveAuditQuestions: readonly string[];
  readonly formattedMarkdown: string;
  readonly compactPrompt: string;
}

export type ReflexiveCheckType = "role_invariants" | "subordinate_fulfillment" | "behavioral_drift";

export type DriftSeverity = "none" | "low" | "medium" | "high" | "critical";

export interface DriftFinding {
  readonly code: string;
  readonly type: ReflexiveCheckType;
  readonly severity: DriftSeverity;
  readonly title: string;
  readonly description: string;
  readonly recommendation: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface ActiveLeaseInfo {
  readonly taskId: string;
  readonly agentId: string;
  readonly writeScope?: readonly string[] | undefined;
  readonly expiresAt?: string | undefined;
  readonly heartbeatAgeMs?: number | undefined;
  readonly isStale?: boolean | undefined;
}

export interface SubordinateAgentInfo {
  readonly agentId: string;
  readonly role: string;
  readonly tier: number;
  readonly status: "active" | "idle" | "stale" | "completed" | "failed";
  readonly taskId?: string | undefined;
  readonly lastHeartbeatAgeMs?: number | undefined;
}

export interface ActionRecord {
  readonly action: string;
  readonly targetFile?: string | undefined;
  readonly spawnedRole?: string | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly timestamp?: string | undefined;
}

export interface SubordinateHealthSummary {
  readonly totalSubordinates: number;
  readonly activeCount: number;
  readonly staleCount: number;
  readonly completedCount: number;
  readonly conflictingScopeCount: number;
  readonly healthy: boolean;
}

export interface ReflexiveAuditContext {
  readonly role: SupervisoryRole | string;
  readonly runId?: string | undefined;
  readonly phase?: string | undefined;
  readonly activeLeases?: readonly ActiveLeaseInfo[] | undefined;
  readonly subordinates?: readonly SubordinateAgentInfo[] | undefined;
  readonly recentActions?: readonly ActionRecord[] | undefined;
  readonly fileModificationsOnSupervisoryThread?: readonly string[] | undefined;
  readonly directExecutionAttempts?: readonly string[] | undefined;
  readonly crossTierSpawns?: readonly string[] | undefined;
  readonly validatorReviewsAcceptedWithoutProof?: number | undefined;
  readonly openFindingsCount?: number | undefined;
  readonly failedGatesCount?: number | undefined;
  readonly unprovenGatesCount?: number | undefined;
  readonly queueReadyCount?: number | undefined;
  readonly queueBlockedCount?: number | undefined;
  readonly isMainThreadExecution?: boolean | undefined;
  readonly attemptedPrematureCompletion?: boolean | undefined;
  readonly rawSourceFileReadsCount?: number | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface ReflexiveAuditEvaluation {
  readonly role: SupervisoryRole;
  readonly tier: number;
  readonly timestamp: string;
  readonly passed: boolean;
  readonly driftScore: number;
  readonly overallSeverity: DriftSeverity;
  readonly findings: readonly DriftFinding[];
  readonly invariantCompliance: Readonly<Record<string, boolean>>;
  readonly subordinateHealth: SubordinateHealthSummary;
  readonly recommendedActions: readonly string[];
  readonly groundingSummary: string;
  readonly markdownReport: string;
}

export interface ScopeOverlapConflict {
  readonly taskA: string;
  readonly taskB: string;
  readonly overlappingFiles: readonly string[];
}

export interface WatchdogAuditPromptOptions {
  readonly tickNumber?: number | undefined;
  readonly runId?: string | undefined;
  readonly activeTaskCount?: number | undefined;
  readonly now?: string | number | Date | undefined;
}
