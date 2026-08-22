import type {
  BlunderCategory,
  BlunderResolutionProof,
  BlunderStatus,
} from "../mind/blunders.ts";

export type { BlunderCategory, BlunderResolutionProof, BlunderStatus };

export interface BlunderOccurrence {
  readonly timestamp: string;
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly agent_id?: string | null | undefined;
  readonly detail?: string | undefined;
}

export interface BlunderRecordInput {
  readonly id?: string | undefined;
  readonly dedup_key?: string | undefined;
  readonly type: string;
  readonly severity?: "critical" | "warning" | "high" | "low" | "info" | string | undefined;
  readonly timestamp?: string | undefined;
  readonly category?: BlunderCategory | string | undefined;
  readonly status?: BlunderStatus | string | undefined;
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
  readonly occurrences?: readonly BlunderOccurrence[] | undefined;
  readonly resolution?: BlunderResolutionProof | null | undefined;
  readonly capsule_root?: string | null | undefined;
}

export interface AggregatedBlunder {
  readonly id: string;
  readonly dedup_key: string;
  readonly type: string;
  readonly severity: string;
  readonly category: BlunderCategory;
  readonly status: BlunderStatus;
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
  readonly occurrences?: readonly BlunderOccurrence[] | undefined;
  readonly resolution?: BlunderResolutionProof | null | undefined;
  readonly capsule_root?: string | null | undefined;
}

export type DeduplicationStrategy = "aggregate_synchronous" | "windowed" | "exact_dedup";

export interface BlunderKeyOptions {
  readonly includeAgentId?: boolean | undefined;
  readonly includeCategory?: boolean | undefined;
  readonly includeType?: boolean | undefined;
  readonly normalizeObservation?: boolean | undefined;
  readonly customDiscriminator?: ((entry: BlunderRecordInput) => string) | undefined;
}

export interface LiveDeduplicationOptions {
  readonly strategy?: DeduplicationStrategy | undefined;
  readonly windowMs?: number | undefined;
  readonly maxOccurrencesTracked?: number | undefined;
  readonly maxEntries?: number | undefined;
  readonly keyOptions?: BlunderKeyOptions | undefined;
}
