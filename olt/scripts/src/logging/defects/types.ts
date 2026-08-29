export type DefectSeverity = "low" | "medium" | "warning" | "high" | "critical" | "info";
export type DefectStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "completed"
  | "closed"
  | "declined"
  | "wontfix"
  | "wont_fix"
  | "reopened";
export type DefectCategory =
  | "boundary_violation"
  | "model_reasoning_error"
  | "code_defect"
  | "documentation"
  | "security_risk"
  | "modularity_violation";

export interface DefectResolutionProof {
  readonly task_id?: string | undefined;
  readonly test_assertion?: string | undefined;
  readonly resolved_at?: string | undefined;
  readonly commit_sha?: string | null | undefined;
  readonly remediation_notes?: string | undefined;
  readonly verified_by?: string | undefined;
  readonly [key: string]: unknown;
}

export interface DefectOccurrence {
  readonly timestamp: string;
  readonly pid?: number | undefined;
  readonly agent_id?: string | undefined;
  readonly observation?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}
export type HistoricalOccurrence = DefectOccurrence;

export interface DefectCuration {
  readonly class: string;
  readonly reason: string;
  readonly original_index?: number | undefined;
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

export interface DefectContext {
  readonly file?: string | undefined;
  readonly function?: string | undefined;
  readonly line?: number | undefined;
  readonly mechanism?: string | undefined;
  readonly [key: string]: unknown;
}

export interface DefectRecordInput {
  readonly id?: string | undefined;
  readonly type?: string | undefined;
  readonly error_code?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly category?: DefectCategory | string | undefined;
  readonly severity?: DefectSeverity | string | undefined;
  readonly observation?: string | undefined;
  readonly message?: string | undefined;
  readonly remediation?: string | undefined;
  readonly prescribed_remediation?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly agent_id?: string | undefined;
  readonly role?: string | undefined;
  readonly pid?: number | undefined;
  readonly status?: DefectStatus | string | undefined;
  readonly resolution?: DefectResolutionProof | undefined;
  readonly resolution_proof?: DefectResolutionProof | undefined;
  readonly context?: Record<string, unknown> | DefectContext | undefined;
  readonly capsule_root?: string | undefined;
  readonly dedup_key?: string | undefined;
  readonly count?: number | undefined;
  readonly first_seen?: string | undefined;
  readonly first_seen_at?: string | undefined;
  readonly last_seen?: string | undefined;
  readonly last_seen_at?: string | undefined;
  readonly occurrences?: readonly DefectOccurrence[] | readonly string[] | undefined;
}

export interface DefectEntry {
  readonly id: string;
  readonly type?: string | undefined;
  readonly domain?: string | undefined;
  readonly error_code?: string | undefined;
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly message?: string | undefined;
  readonly actor?: string | undefined;
  readonly role?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly source_repo?: string | undefined;
  readonly context?: Record<string, unknown> | DefectContext | undefined;
  readonly status: DefectStatus | string;
  readonly category?: DefectCategory | string | undefined;
  readonly severity?: DefectSeverity | string | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly prescribed_remediation?: string | undefined;
  readonly resolution?: DefectResolutionProof | undefined;
  readonly resolution_proof?: DefectResolutionProof | undefined;
  readonly failure_proof?: EmpiricalFailureProof | undefined;
  readonly curation?: Record<string, unknown> | DefectCuration | undefined;
  readonly occurrences?: readonly DefectOccurrence[] | readonly string[] | undefined;
  readonly count?: number | undefined;
  readonly first_seen?: string | undefined;
  readonly first_seen_at?: string | undefined;
  readonly last_seen?: string | undefined;
  readonly last_seen_at?: string | undefined;
  readonly reopened_at?: string | undefined;
  readonly dedup_key?: string | undefined;
  readonly capsule_root?: string | undefined;
  readonly agent_id?: string | undefined;
  readonly pid?: number | undefined;
}

export interface AggregatedDefect extends DefectEntry {
  readonly count: number;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly occurrences: readonly DefectOccurrence[];
}

export interface ParseDefectLogOptions {
  readonly filterCategory?: DefectCategory | undefined;
  readonly filterStatus?: DefectStatus | undefined;
  readonly maxAgeMs?: number | undefined;
}

export interface LiveDeduplicationOptions {
  readonly strategy?:
    | "aggregate_synchronous"
    | "exact_dedup"
    | "windowed"
    | "sliding_window_hash"
    | undefined;
  readonly windowMs?: number | undefined;
  readonly maxEntries?: number | undefined;
  readonly maxOccurrences?: number | undefined;
  readonly maxOccurrencesTracked?: number | undefined;
  readonly keyOptions?: DefectKeyOptions | undefined;
  readonly onNewDefect?: ((defect: AggregatedDefect) => void) | undefined;
  readonly onDefectDeduplicated?:
    | ((defect: AggregatedDefect, incoming: DefectRecordInput) => void)
    | undefined;
}

export interface DefectKeyOptions {
  readonly includeAgentId?: boolean | undefined;
  readonly includeCategory?: boolean | undefined;
  readonly includeType?: boolean | undefined;
  readonly normalizeObservation?: boolean | undefined;
  readonly useContentHash?: boolean | undefined;
  readonly hashAlgorithm?: "fnv1a" | "sha256" | undefined;
  readonly customDiscriminator?: ((defect: DefectRecordInput) => string) | undefined;
}

export interface DefectHypothesis {
  readonly id: string;
  readonly defect_id: string;
  readonly root_cause: string;
  readonly confidence: number;
  readonly category: DefectCategory | string;
  readonly evidence: readonly string[];
}

export interface DefectRemediationAction {
  readonly id?: string | undefined;
  readonly action_id: string;
  readonly defect_id: string;
  readonly target_scope: readonly string[] | string;
  readonly action_type:
    | "fix_code"
    | "tighten_boundary"
    | "align_reasoning"
    | "update_docs"
    | "add_test_gate"
    | string;
  readonly description: string;
  readonly prescribed_test: string;
  readonly priority?: string | undefined;
  readonly status: "planned" | "in_progress" | "verified" | "failed" | string;
}
