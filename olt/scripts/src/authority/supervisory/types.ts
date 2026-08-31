import type { ManifestLoaderOptions } from "../manifest/index.ts";

export type ChecklistItemStatus =
  | "pending"
  | "completed"
  | "neglected"
  | "violated"
  | "not_applicable";

export type ChecklistCategory =
  | "boundary"
  | "dispatch"
  | "verification"
  | "governance"
  | "scaling"
  | "observability"
  | "hygiene";

export type DecisionProtocolId =
  | "work_span_scaling"
  | "anti_batching_continuous_dispatch"
  | "supervisor_zero_file_edit"
  | "four_tier_viewport_matrix"
  | "scepticism_quantitative_proof"
  | "strict_tier_hierarchy"
  | "infinite_pulse_cadence"
  | "dual_channel_validation"
  | "standardized_agent_naming"
  | "quota_freeze_zero_kill_resume"
  | "perpetual_creative_product_owner"
  | "mandatory_tier_0_companion_auditors"
  | "mailbox_ipc_main_thread_silence";

export interface DecisionProtocolDefinition {
  readonly id: DecisionProtocolId;
  readonly name: string;
  readonly summary: string;
  readonly formulaOrRule: string;
  readonly keyInvariants: readonly string[];
  readonly operationalGuidance: string;
  readonly applicableTiers: readonly number[];
}

export interface ChecklistItemDefinition {
  readonly id: string;
  readonly category: ChecklistCategory;
  readonly title: string;
  readonly mandate: string;
  readonly verificationCriteria: string;
  readonly protocolKey?: DecisionProtocolId | undefined;
  readonly targetRoles: readonly string[];
}

export type PersonaViolationSeverity = "none" | "low" | "medium" | "high" | "critical";

export interface PersonaViolation {
  readonly code: string;
  readonly rule: string;
  readonly severity: PersonaViolationSeverity;
  readonly message: string;
  readonly correctiveDirective: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface ChecklistItemEvaluation {
  readonly id: string;
  readonly category: ChecklistCategory;
  readonly title: string;
  readonly status: ChecklistItemStatus;
  readonly evidence?: string | undefined;
  readonly reason?: string | undefined;
  readonly correctiveDirective?: string | undefined;
}

export interface ActiveLeaseContext {
  readonly taskId: string;
  readonly agentId: string;
  readonly role?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly isStale?: boolean | undefined;
  readonly heartbeatAgeMs?: number | undefined;
}

export interface SubordinateContext {
  readonly agentId: string;
  readonly role: string;
  readonly tier: number;
  readonly status: "active" | "idle" | "stale" | "completed" | "failed";
  readonly lastHeartbeatAgeMs?: number | undefined;
}

export interface QueueStateContext {
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly runningCount: number;
  readonly totalCount: number;
}

export interface ActionContext {
  readonly action: string;
  readonly targetFile?: string | undefined;
  readonly spawnedRole?: string | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly timestamp?: string | undefined;
}

export interface SupervisoryReminderEvaluationContext {
  readonly role: string;
  readonly agentId?: string | undefined;
  readonly runId?: string | null | undefined;
  readonly pulseId?: string | null | undefined;
  readonly tickNumber?: number | undefined;
  readonly cadenceMs?: number | undefined;
  readonly phase?: string | undefined;
  readonly activeLeases?: readonly ActiveLeaseContext[] | undefined;
  readonly subordinates?: readonly SubordinateContext[] | undefined;
  readonly queueState?: QueueStateContext | undefined;
  readonly openFindingsCount?: number | undefined;
  readonly failedGatesCount?: number | undefined;
  readonly unprovenGatesCount?: number | undefined;
  readonly recentActions?: readonly ActionContext[] | undefined;
  readonly fileModificationsOnSupervisoryThread?: readonly string[] | undefined;
  readonly directExecutionAttempts?: readonly string[] | undefined;
  readonly crossTierSpawns?: readonly string[] | undefined;
  readonly uiTasksMissingViewportValidation?: readonly string[] | undefined;
  readonly qualitativePassesWithoutProof?: readonly string[] | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly attemptedPrematureCompletion?: boolean | undefined;
  readonly adversarialProbeRecorded?: boolean | undefined;
  readonly hasUnresolvedProbeDemands?: boolean | undefined;
  readonly evidenceVerification?:
    | import("../../mind/evidence/types.ts").MilestoneEvidenceVerification
    | undefined;
  readonly evidenceVerificationFailed?: boolean | undefined;
  readonly subagentIdleWarningCount?: number | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface SupervisoryStateEvaluation {
  readonly role: string;
  readonly tier: number;
  readonly compliant: boolean;
  readonly driftScore: number;
  readonly severity: PersonaViolationSeverity;
  readonly checklist: readonly ChecklistItemEvaluation[];
  readonly violations: readonly PersonaViolation[];
  readonly correctiveDirectives: readonly string[];
  readonly applicableDecisionProtocols: readonly DecisionProtocolDefinition[];
  readonly summary: string;
}

export interface SupervisoryScopeConflict {
  readonly taskA: string;
  readonly taskB: string;
  readonly overlappingFiles: readonly string[];
}

export interface SupervisoryPersonaReminderOptions {
  readonly role: string;
  readonly agentId?: string | undefined;
  readonly runId?: string | null | undefined;
  readonly pulseId?: string | null | undefined;
  readonly tickNumber?: number | undefined;
  readonly cadenceMs?: number | undefined;
  readonly startedAt?: string | number | Date | undefined;
  readonly now?: string | number | Date | undefined;
  readonly context?: SupervisoryReminderEvaluationContext | undefined;
  readonly manifestLoaderOptions?: ManifestLoaderOptions | undefined;
}

export interface SupervisoryPersonaReminder {
  readonly id: string;
  readonly role: string;
  readonly tier: number;
  readonly agentId: string | null;
  readonly runId: string | null;
  readonly pulseId: string | null;
  readonly tickNumber: number;
  readonly timestamp: string;
  readonly cadenceMs: number;
  readonly elapsedMs: number;
  readonly persona: {
    readonly name: string;
    readonly displayName: string;
    readonly shortDescription: string;
    readonly archetype: string;
    readonly coreMandate: string;
    readonly may: readonly string[];
    readonly mustNot: readonly string[];
    readonly commands: readonly string[];
    readonly spawns: readonly string[];
    readonly instructions: string;
  };
  readonly decisionProtocols: readonly DecisionProtocolDefinition[];
  readonly checklist: readonly ChecklistItemEvaluation[];
  readonly evaluation: SupervisoryStateEvaluation;
  readonly correctiveDirectives: readonly string[];
  readonly renderedMarkdown: string;
  readonly compactPromptInjection: string;
  readonly heartbeatTickBrief: string;
}
