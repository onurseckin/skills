/**
 * Shared Leaf Contracts for Defect Management & Tracking
 */

export type DefectSeverity = "low" | "medium" | "high" | "critical";

export type DefectCategory =
  | "boundary_violation"
  | "model_reasoning_error"
  | "code_defect"
  | "documentation"
  | "security_risk"
  | "modularity_violation";

export type DefectStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "completed"
  | "closed"
  | "declined"
  | "reopened";

export type DefectType =
  | "CODE_HEALTH"
  | "DOCUMENTATION"
  | "INVARIANT_BREACH"
  | "TEST_FAILURE"
  | "BEHAVIORAL_REGRESSION"
  | "SECURITY_RISK"
  | "MODULARITY_VIOLATION"
  | "TYPE_DRIFT"
  | "SCHEMA_MISMATCH"
  | "RUNTIME_ERROR"
  | "LIFECYCLE_ORDERING"
  | "DOCTOR_FINDING";

export type DefectCurationClass = "FIRST_PARTY" | "FOREIGN_REPO" | "BENIGN_NOISE" | "DEFERRED";

export interface DefectCuration {
  readonly class: DefectCurationClass;
  readonly reason: string;
  readonly original_index?: number | undefined;
}

export interface DefectContext {
  readonly file?: string | undefined;
  readonly function?: string | undefined;
  readonly line?: number | undefined;
  readonly mechanism?: string | undefined;
  readonly documented_default?: string | undefined;
  readonly consequence?: string | undefined;
  readonly stacks_with?: readonly string[] | undefined;
  readonly unproven_lead?: string | undefined;
  readonly severity?: DefectSeverity | undefined;
  readonly rule?: string | undefined;
  readonly command?: string | undefined;
  readonly [key: string]: unknown;
}

export interface DefectResolutionProof {
  readonly commit_sha?: string | null | undefined;
  readonly test_assertion?: string | undefined;
  readonly task_id?: string | undefined;
  readonly resolved_at?: string | undefined;
  readonly explanation?: string | undefined;
  readonly empirical_command?: string | undefined;
  readonly verified?: boolean | undefined;
  readonly [key: string]: unknown;
}

export interface DefectEntry {
  readonly id: string;
  readonly domain?: string | undefined;
  readonly error_code?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly message?: string | undefined;
  readonly actor?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly source_repo?: string | undefined;
  readonly context?: Record<string, unknown> | DefectContext | undefined;
  readonly status: DefectStatus | string;
  readonly type?: string | undefined;
  readonly category?: DefectCategory | string | undefined;
  readonly severity?: DefectSeverity | string | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly prescribed_remediation?: string | undefined;
  readonly curation?: Record<string, unknown> | DefectCuration | undefined;
  readonly resolution?: DefectResolutionProof | undefined;
  readonly resolution_proof?: DefectResolutionProof | undefined;
  readonly failure_proof?: EmpiricalFailureProof | undefined;
  readonly occurrences?:
    | readonly string[]
    | readonly import("../defects/core/types.ts").DefectOccurrence[]
    | undefined;
  readonly count?: number | undefined;
  readonly first_seen?: string | undefined;
  readonly first_seen_at?: string | undefined;
  readonly last_seen?: string | undefined;
  readonly last_seen_at?: string | undefined;
  readonly reopened_at?: string | undefined;
  readonly dedup_key?: string | undefined;
  readonly capsule_root?: string | undefined;
  readonly role?: string | undefined;
  readonly agent_id?: string | undefined;
  readonly pid?: number | undefined;
}

export interface AggregatedDefect extends DefectEntry {
  readonly count: number;
  readonly first_seen: string;
  readonly last_seen: string;
  readonly occurrences: readonly string[];
}

export interface DefectDiscriminatorOptions {
  readonly includeAgent?: boolean | undefined;
  readonly includeCategory?: boolean | undefined;
  readonly customExtractor?: ((entry: DefectEntry) => string) | undefined;
}

export interface DefectAggregateMetrics {
  readonly total: number;
  readonly open: number;
  readonly resolved: number;
  readonly completed: number;
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}

export interface EmpiricalFailureProof {
  readonly commit_sha?: string | undefined;
  readonly test_assertion?: string | undefined;
  readonly task_id?: string | undefined;
  readonly run_id?: string | undefined;
  readonly error_code?: string | undefined;
  readonly message?: string | undefined;
  readonly timestamp: string;
  readonly [key: string]: unknown;
}

export interface SyncDoctorDefectOptions {
  readonly defectsPath?: string | undefined;
  readonly customPath?: string | undefined;
  readonly runId?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly autoReopen?: boolean | undefined;
  readonly failureProof?: EmpiricalFailureProof | undefined;
  readonly dryRun?: boolean | undefined;
  readonly requireStrictProof?: boolean | undefined;
}

export interface SyncDefectResult {
  readonly totalFindings: number;
  readonly newlyCreated: number;
  readonly reopened: number;
  readonly existingUpdated: number;
  readonly unchanged: number;
  readonly defects: readonly DefectEntry[];
  readonly pushed_count?: number;
  readonly reopened_count?: number;
  readonly skipped_count?: number;
  readonly total_findings?: number;
  readonly defects_file?: string;
}
