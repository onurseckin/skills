import { createHash } from "node:crypto";
import { HarnessError } from "../../../core/errors/index.ts";
import { transact } from "../../../engine/store/index.ts";
import { DEFAULT_MIND_BUDGET } from "../../lifecycle/charter/index.ts";

export type ProposalStatus =
  | "opened"
  | "needs_authority"
  | "granted"
  | "admitted"
  | "in_progress"
  | "completed"
  | "declined"
  | "revised";

export const PROPOSAL_WITNESS_OWNER_DECISION = "owner-decision";
export const PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE = "autonomous-initiative";
export const DEFAULT_MAX_OPEN_PROPOSALS = DEFAULT_MIND_BUDGET.max_open_proposals ?? 5;
export const DEFAULT_PROPOSAL_MIN_INTERVAL_MS = 86_400_000; // 24 hours
export const DEFAULT_INITIATIVE_CONFIDENCE_THRESHOLD = 0.85;

export const VALID_PROPOSAL_TRANSITIONS: Readonly<
  Record<ProposalStatus, readonly ProposalStatus[]>
> = {
  opened: ["needs_authority", "admitted", "declined"],
  needs_authority: ["granted", "admitted", "declined"],
  granted: ["admitted", "declined", "revised"],
  admitted: ["in_progress", "completed", "declined", "revised"],
  in_progress: ["completed", "declined", "revised"],
  revised: ["needs_authority", "admitted", "in_progress", "declined"],
  completed: [],
  declined: [],
};

export interface MindProposal {
  readonly id: string;
  readonly kind: "proposal";
  readonly statement: string;
  readonly rationale: string;
  readonly charter_goal_ids: readonly string[];
  readonly falsifier_argv?: readonly string[] | undefined;
  readonly falsifier_exit?: number | undefined;
  readonly write_scope: readonly string[];
  readonly status: ProposalStatus;
  readonly requirement_id: string;
  readonly disposition: "needs_authority" | "actionable" | "out_of_scope" | "completed";
  readonly witness?: string | null | undefined;
  readonly witness_command_id?: string | null | undefined;
  readonly created_at: string;
  readonly created_pulse?: number | string | undefined;
  readonly decided_at?: string | null | undefined;
  readonly decided_by?: string | null | undefined;
  readonly decline_reason?: string | null | undefined;
  readonly gate_failed?: string | null | undefined;
  readonly objective_run_id?: string | null | undefined;
  readonly evidence_class: "agent_reported";
  readonly fingerprint?: string | undefined;
  readonly revision_count?: number | undefined;
  readonly parent_proposal_id?: string | null | undefined;
  readonly autonomous_initiative?: boolean | undefined;
  readonly initiative_trigger_id?: string | null | undefined;
  readonly initiative_score?: number | undefined;
}

export interface RecordProposalOptions {
  readonly id?: string | undefined;
  readonly statement: string;
  readonly rationale: string;
  readonly charter_goal_ids: readonly string[];
  readonly falsifier_argv?: readonly string[] | undefined;
  readonly falsifier_exit?: number | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly actor: string;
  readonly pulseId?: string | number | undefined;
  readonly witness?: string | null | undefined;
  readonly witness_command_id?: string | null | undefined;
  readonly now?: number | Date | string | undefined;
  readonly maxOpenProposals?: number | undefined;
  readonly minIntervalMs?: number | undefined;
  readonly autonomousInitiative?: boolean | undefined;
  readonly initiativeTriggerId?: string | undefined;
  readonly initiativeScore?: number | undefined;
}

export interface ProposalRateLimitCheckResult {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
  readonly openCount: number;
  readonly maxOpen: number;
  readonly remainingCooldownMs?: number | undefined;
}

export interface ProposalAuthorityDecisionInput {
  readonly decision: "grant" | "decline";
  readonly rationale: string;
}

export interface DecideProposalOptions {
  readonly actorRole?: string | undefined;
  readonly now?: number | Date | string | undefined;
}

export interface TransitionProposalOptions {
  readonly actorRole?: string | undefined;
  readonly now?: number | Date | string | undefined;
  readonly rationale?: string | undefined;
  readonly witness?: string | undefined;
  readonly witnessCommandId?: string | undefined;
  readonly gateFailed?: string | undefined;
  readonly declineReason?: string | undefined;
}

export type PlanRevisionSignalType =
  | "TEST_REGRESSION"
  | "PERFORMANCE_DEGRADATION"
  | "COGNITIVE_OVERLOAD"
  | "DEFECT_SURGE"
  | "DORMANT_CRITERIA"
  | "QUIESCENCE_EVOLUTION"
  | "SCOPE_COLLISION"
  | "ORCHESTRATOR_BOTTLENECK";

export type PlanRevisionType =
  | "TASK_SPLIT"
  | "SCOPE_REFINEMENT"
  | "PRIORITY_ESCALATION"
  | "COORDINATOR_REORGANIZATION"
  | "DEPENDENCY_RESTRUCTURING"
  | "NEW_EVOLUTION_BRANCH";

export interface PlanRevisionSignal {
  readonly signalType: PlanRevisionSignalType;
  readonly source: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  readonly evidence: string;
  readonly affectedWriteScopes: readonly string[];
  readonly charterGoalId: string;
  readonly detectedAt?: string | undefined;
  readonly metricValue?: number | undefined;
  readonly thresholdValue?: number | undefined;
}

export interface PlanRevisionTaskSpec {
  readonly id: string;
  readonly label: string;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals: readonly string[];
  readonly rationale: string;
  readonly dependencies?: readonly string[] | undefined;
  readonly priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND" | undefined;
}

export interface PlanRevisionProposal {
  readonly id: string;
  readonly targetProposalId?: string | undefined;
  readonly targetTaskId?: string | undefined;
  readonly revisionType: PlanRevisionType;
  readonly signal: PlanRevisionSignal;
  readonly proposedChanges: {
    readonly summary: string;
    readonly newTasks?: readonly PlanRevisionTaskSpec[] | undefined;
    readonly modifiedTaskIds?: readonly string[] | undefined;
    readonly revisedWriteScopes?: readonly string[] | undefined;
    readonly newPriority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND" | undefined;
    readonly recommendedCoordinators?: number | undefined;
  };
  readonly autonomousAdvancementEligible: boolean;
  readonly confidenceScore: number;
  readonly createdAt: string;
}

export interface GeneratePlanRevisionOptions {
  readonly now?: number | Date | string | undefined;
  readonly confidenceThreshold?: number | undefined;
  readonly maxRevisionsPerSignal?: number | undefined;
  readonly baseWriteScope?: readonly string[] | undefined;
}

export interface PlanRevisionApplicationResult {
  readonly revisionId: string;
  readonly applied: boolean;
  readonly updatedProposal?: MindProposal | undefined;
  readonly createdProposals: readonly MindProposal[];
  readonly summary: string;
  readonly appliedAt: string;
}

export type InitiativeActionType =
  | "AUTONOMOUS_ADMIT"
  | "AUTONOMOUS_SPLIT"
  | "AUTONOMOUS_ESCALATE"
  | "REQUIRES_HUMAN_AUTHORITY";

export interface InitiativeEvaluationInput {
  readonly proposal:
    | MindProposal
    | {
        readonly id?: string | undefined;
        readonly statement: string;
        readonly rationale: string;
        readonly charter_goal_ids: readonly string[];
        readonly write_scope?: readonly string[] | undefined;
        readonly category?: string | undefined;
      };
  readonly confidenceScore: number;
  readonly signals?: readonly PlanRevisionSignal[] | undefined;
  readonly charterProhibitions?: readonly string[] | undefined;
  readonly repoRoots?: readonly string[] | undefined;
  readonly confidenceThreshold?: number | undefined;
}

export interface InitiativeEvaluationResult {
  readonly canAdvanceAutonomously: boolean;
  readonly initiativeScore: number;
  readonly action: InitiativeActionType;
  readonly reason: string;
  readonly triggerId: string;
  readonly safetyChecks: {
    readonly withinRepoRoots: boolean;
    readonly avoidsProhibitions: boolean;
    readonly charterAligned: boolean;
    readonly confidenceThresholdMet: boolean;
    readonly notDeclined: boolean;
  };
}
