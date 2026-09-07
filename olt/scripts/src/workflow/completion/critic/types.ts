import type { Clock } from "../../index.ts";

export interface RouteCriticFindingsOptions {
  readonly maxRepairRounds?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly escalationThresholdRepeatFindings?: number | undefined;
}

export interface TaskRepairSummary {
  readonly taskId: string;
  readonly priorStatus: string;
  readonly newStatus: "changes_requested" | "escalated";
  readonly repairRound: number;
  readonly repairAssignee: string;
  readonly assignedFindingsCount: number;
  readonly isEscalated: boolean;
  readonly escalationReason?: string | undefined;
}

export interface RouteCriticFindingsResult {
  readonly reviewedStatus: "clean" | "findings";
  readonly totalFindingsRouted: number;
  readonly affectedTaskIds: readonly string[];
  readonly changesRequestedTaskIds: readonly string[];
  readonly escalatedTaskIds: readonly string[];
  readonly summaries: readonly TaskRepairSummary[];
}

export interface TaskRepairBudgetStatus {
  readonly repairRound: number;
  readonly maxRepairRounds: number;
  readonly remainingBudget: number;
  readonly isExhausted: boolean;
  readonly deterministicDefectDetected: boolean;
}
