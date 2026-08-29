import type { TaskStatus } from "../../../../core/contracts/index.ts";
import type { Clock } from "../../../../workflow/types.ts";

export type ReviewerRole = "completeness-critic" | "validator";

export interface CriticFindingInput {
  readonly id: string;
  readonly requirement_id: string;
  readonly severity?: "critical" | "important" | "minor" | undefined;
  readonly observation: string;
  readonly counterfactualRequirement?: string | undefined;
  readonly evidence?: readonly Record<string, unknown>[] | undefined;
  readonly remediation?: string | undefined;
  readonly revalidation?: string | undefined;
  readonly affectedFilePaths?: readonly string[] | undefined;
}

export interface CriticFindingDetail {
  readonly id: string;
  readonly requirement_id: string;
  readonly severity: "critical" | "important" | "minor";
  readonly observation: string;
  readonly counterfactualRequirement: string;
  readonly evidence: readonly Record<string, unknown>[];
  readonly remediation: string;
  readonly revalidation: string;
  readonly status: "open" | "resolved";
  readonly affectedFilePaths: readonly string[];
}

export type PairAssignmentStrategy = "same_author" | "replacement_pair";

export interface ImplementerValidatorBinding {
  readonly implementerId: string;
  readonly validatorId: string;
  readonly isReplacementPair: boolean;
}

export interface ClosedLoopRepairPayload {
  readonly taskId: string;
  readonly repairRound: number;
  readonly priorStatus: TaskStatus;
  readonly newStatus: "changes_requested" | "escalated";
  readonly binding: ImplementerValidatorBinding;
  readonly writeScope: readonly string[];
  readonly findings: readonly CriticFindingDetail[];
  readonly counterfactualRequirements: readonly string[];
  readonly revalidationGates: readonly string[];
  readonly repairDirectives: string;
  readonly isEscalated: boolean;
  readonly escalationReason?: string | undefined;
}

export interface CompiledRepairDagNode {
  readonly taskId: string;
  readonly role: "repairer";
  readonly tier: number;
  readonly status: TaskStatus;
  readonly repairRound: number;
  readonly assignee: string;
  readonly validatorAssignee: string;
  readonly writeScope: readonly string[];
  readonly dependencies: readonly string[];
  readonly counterfactualRequirements: readonly string[];
  readonly revalidationCommand: string;
  readonly directives: string;
}

export interface CompiledRepairDag {
  readonly revision: number;
  readonly roundNumber: number;
  readonly nodes: readonly CompiledRepairDagNode[];
  readonly totalWork: number;
  readonly totalSpan: number;
  readonly parallelismFactor: number;
  readonly isAcyclic: boolean;
  readonly criticalPath: readonly string[];
  readonly dominatingDirectives: readonly string[];
}

export interface RouteCriticFeedbackOptions {
  readonly maxRepairRounds?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly pairStrategy?: PairAssignmentStrategy | undefined;
  readonly availableImplementers?: readonly string[] | undefined;
  readonly availableValidators?: readonly string[] | undefined;
  readonly enforceZeroTolerance?: boolean | undefined;
}

export interface ConvergenceReport {
  readonly converged: boolean;
  readonly activeRepairCount: number;
  readonly escalatedCount: number;
  readonly closedCount: number;
  readonly maxRepairRoundReached: number;
  readonly isStalled: boolean;
  readonly stalledTaskIds: readonly string[];
}
