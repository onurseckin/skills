import type {
  DefectAuditReport,
  DefectCategory,
  DefectDeliberationRound,
  DefectEntry,
  DefectHypothesis,
  DefectRemediationAction,
  DefectRemediationSynthesis,
  DefectResolutionProof,
  DefectStatus,
  DeliberationPipelineOptions,
} from "../defects.ts";

export type {
  DefectAuditReport,
  DefectCategory,
  DefectDeliberationRound,
  DefectEntry,
  DefectHypothesis,
  DefectRemediationAction,
  DefectRemediationSynthesis,
  DefectResolutionProof,
  DefectStatus,
  DeliberationPipelineOptions,
};

export interface DefectOccurrence {
  readonly timestamp: string;
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly agent_id?: string | null | undefined;
  readonly detail?: string | undefined;
}

export interface DefectRecordInput {
  readonly id?: string | undefined;
  readonly dedup_key?: string | undefined;
  readonly type: string;
  readonly severity?: "critical" | "warning" | "high" | "low" | "info" | string | undefined;
  readonly timestamp?: string | undefined;
  readonly category?: DefectCategory | string | undefined;
  readonly status?: DefectStatus | string | undefined;
  readonly observation?: string | undefined;
  readonly message?: string | undefined;
  readonly remediation?: string | undefined;
  readonly prescribed_remediation?: string | undefined;
  readonly role?: string | undefined;
  readonly agent_id?: string | null | undefined;
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly count?: number | undefined;
  readonly first_seen_at?: string | undefined;
  readonly last_seen_at?: string | undefined;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
  readonly occurrences?: readonly DefectOccurrence[] | undefined;
  readonly resolution?: DefectResolutionProof | null | undefined;
  readonly capsule_root?: string | null | undefined;
}

export interface AggregatedDefect {
  readonly id: string;
  readonly dedup_key: string;
  readonly type: string;
  readonly severity: string;
  readonly category: DefectCategory;
  readonly status: DefectStatus;
  readonly timestamp: string;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly count: number;
  readonly observation: string;
  readonly remediation: string;
  readonly message?: string | undefined;
  readonly prescribed_remediation?: string | undefined;
  readonly role?: string | undefined;
  readonly agent_id?: string | null | undefined;
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
  readonly occurrences?: readonly DefectOccurrence[] | undefined;
  readonly resolution?: DefectResolutionProof | null | undefined;
  readonly capsule_root?: string | null | undefined;
}

export type DeduplicationStrategy =
  | "aggregate_synchronous"
  | "windowed"
  | "exact_dedup"
  | "sliding_window_hash";

export type ContentHashAlgorithm = "sha256" | "fnv1a";

export interface DefectKeyOptions {
  readonly includeAgentId?: boolean | undefined;
  readonly includeCategory?: boolean | undefined;
  readonly includeType?: boolean | undefined;
  readonly normalizeObservation?: boolean | undefined;
  readonly useContentHash?: boolean | undefined;
  readonly hashAlgorithm?: ContentHashAlgorithm | undefined;
  readonly customDiscriminator?: ((entry: DefectRecordInput) => string) | undefined;
}

export interface LiveDeduplicationOptions {
  readonly strategy?: DeduplicationStrategy | undefined;
  readonly windowMs?: number | undefined;
  readonly maxOccurrencesTracked?: number | undefined;
  readonly maxEntries?: number | undefined;
  readonly keyOptions?: DefectKeyOptions | undefined;
  readonly onDefectDeduplicated?:
    | ((existing: AggregatedDefect, incoming: DefectRecordInput) => void)
    | undefined;
  readonly onNewDefect?: ((entry: AggregatedDefect) => void) | undefined;
}

export interface DefectAggregateMetrics {
  readonly total_recorded: number;
  readonly unique_defects: number;
  readonly open_count: number;
  readonly resolved_count: number;
  readonly wontfix_count: number;
  readonly recurrence_count: number;
  readonly recurrence_rate: number;
  readonly by_category: Readonly<Record<DefectCategory, number>>;
  readonly by_severity: Readonly<Record<string, number>>;
  readonly mean_time_to_resolution_ms: number | null;
}

export interface DefectStreamOptions extends LiveDeduplicationOptions {
  readonly bufferSize?: number | undefined;
  readonly flushIntervalMs?: number | undefined;
}
