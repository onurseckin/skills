import type { SupervisoryPersonaReminder } from "../../../authority/supervisory/index.ts";
import type {
  AgentBadgeItem,
  QuotaBudgetBadgeItem,
  TaskBadgeItem,
  WaveLaneBadgeItem,
} from "../diagnostics/ascii-badges.ts";

export interface SchedulerTaskSummary extends TaskBadgeItem {
  readonly effort: number;
  readonly dependencies: readonly string[];
  readonly writeScope?: readonly string[] | undefined;
}

export interface SchedulerAgentSummary extends AgentBadgeItem {
  readonly host: string;
}

export interface SchedulerWaveGroupSummary {
  readonly wave: number;
  readonly laneCount: number;
  readonly status: string;
  readonly isActive: boolean;
  readonly taskIds: readonly string[];
}

export interface SchedulerProgressSnapshot {
  readonly capturedAt: string;
  readonly runRoot: string;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly leasedTasks: number;
  readonly readyTasks: number;
  readonly proposedTasks: number;
  readonly failedTasks: number;
  readonly tasks: readonly SchedulerTaskSummary[];
  readonly activeAgents: readonly SchedulerAgentSummary[];
  readonly waves: readonly SchedulerWaveGroupSummary[];
  readonly activeWave: number | null;
  readonly totalWaves: number;
  readonly quotaUsedToday: number;
  readonly quotaLimitToday: number | null;
  readonly wallClockMsToday: number;
}

export interface SchedulerProgressDiff {
  readonly hasPrevious: boolean;
  readonly completedDelta: number;
  readonly newlyCompletedTaskIds: readonly string[];
  readonly newlyLeasedTaskIds: readonly string[];
  readonly newlyFailedTaskIds: readonly string[];
  readonly newlyReadyTaskIds: readonly string[];
  readonly agentDelta: number;
  readonly activeWaveChanged: boolean;
  readonly previousActiveWave: number | null;
  readonly currentActiveWave: number | null;
  readonly isZeroProgress: boolean;
  readonly consecutiveZeroProgressTicks: number;
  readonly summary: string;
}

export type StagnationSeverity = "none" | "info" | "warning" | "critical";

export interface StagnationWarning {
  readonly level: StagnationSeverity;
  readonly isStagnating: boolean;
  readonly streak: number;
  readonly reason: string;
  readonly remediation: string;
  readonly badge: string;
}

export interface SchedulerLiveReportOptions {
  readonly runRoot: string;
  readonly state: Record<string, unknown>;
  readonly previousState?: Record<string, unknown> | undefined;
  readonly previousSnapshot?: SchedulerProgressSnapshot | undefined;
  readonly nowMs?: number | undefined;
  readonly actor?: string | undefined;
  readonly host?: string | undefined;
  readonly driver?: string | undefined;
  readonly pulseId?: string | undefined;
  readonly budget?: QuotaBudgetBadgeItem | undefined;
  readonly personaReminder?: SupervisoryPersonaReminder | undefined;
  readonly zeroValueStreak?: number | undefined;
  readonly stagnationWarningThreshold?: number | undefined;
  readonly stagnationCriticalThreshold?: number | undefined;
  readonly includeAsciiBadges?: boolean | undefined;
  readonly includeDiff?: boolean | undefined;
  readonly compact?: boolean | undefined;
}

export interface SchedulerLivePushBadges {
  readonly dagBadges: readonly string[];
  readonly agentBadge: string;
  readonly quotaBadge: string;
  readonly waveLaneBadges: readonly string[];
  readonly stagnationBadge: string;
  readonly telemetryBanner: string;
}

export interface SchedulerLivePushReport {
  readonly markdown: string;
  readonly snapshot: SchedulerProgressSnapshot;
  readonly diff: SchedulerProgressDiff;
  readonly stagnation: StagnationWarning;
  readonly asciiBadges: SchedulerLivePushBadges;
  readonly eventLedgerEntry: {
    readonly kind: string;
    readonly timestamp: string;
    readonly payload: Record<string, unknown>;
  };
  readonly pushedAt: string;
  readonly isStagnating: boolean;
}
