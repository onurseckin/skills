export type BoundaryViolationType =
  | "role_confinement_violation"
  | "critic_code_edit"
  | "validator_write_lease"
  | "supervisor_code_contamination"
  | "self_repair_violation"
  | "cross_tier_boundary_leak"
  | "validator_hardlock_violation";

export type BoundaryViolationSeverity = "critical" | "important" | "minor";

export interface BoundaryLeakCheck {
  readonly agent_id: string;
  readonly role: string;
  readonly action: string;
  readonly write_scope?: readonly string[] | undefined;
  readonly task_id?: string | undefined;
  readonly target_file?: string | undefined;
  readonly findings?: readonly unknown[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface BoundaryViolation {
  readonly violation_type: BoundaryViolationType;
  readonly severity: BoundaryViolationSeverity;
  readonly agent_id: string;
  readonly role: string;
  readonly task_id?: string | undefined;
  readonly action?: string | undefined;
  readonly target_file?: string | undefined;
  readonly observation: string;
  readonly remediation: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface RepairDelegationOrder {
  readonly task_id: string;
  readonly original_implementer: string;
  readonly assigned_repairer: string;
  readonly validator_id?: string | undefined;
  readonly finding_ids?: readonly string[] | undefined;
  readonly write_scope: readonly string[];
  readonly reason: "repeated_failure" | "stale" | "unavailable" | "finding_remediation";
  readonly repair_round: number;
  readonly command: string;
  readonly generated_at: string;
}

export interface AntiLeakValidationResult {
  readonly compliant: boolean;
  readonly valid: boolean;
  readonly violations: readonly BoundaryViolation[];
  readonly delegation_orders?: readonly RepairDelegationOrder[] | undefined;
  readonly summary?: string | undefined;
}

export interface DelegateRepairTaskParams {
  readonly taskId: string;
  readonly originalImplementer: string;
  readonly assignedRepairer?: string | undefined;
  readonly validatorId?: string | undefined;
  readonly findingIds?: readonly string[] | undefined;
  readonly writeScope: readonly string[];
  readonly repairRound?: number | undefined;
  readonly reason?:
    | "repeated_failure"
    | "stale"
    | "unavailable"
    | "finding_remediation"
    | undefined;
  readonly runRoot?: string | undefined;
}

export interface AcyclicPushbackValidationParams {
  readonly taskId: string;
  readonly validatorId: string;
  readonly assignedRepairer?: string | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly findings?: readonly unknown[] | undefined;
  readonly repairRound?: number | undefined;
  readonly dependencyGraph?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface AcyclicPushbackValidationResult {
  readonly valid: boolean;
  readonly acyclic: boolean;
  readonly structured: boolean;
  readonly violations: readonly string[];
  readonly remediation_guidance?: string | undefined;
}
