import type {
  AggregatedDefect,
  DefectCategory,
  DefectEntry,
  DefectKeyOptions,
  DefectOccurrence,
  DefectRecordInput,
  DefectResolutionProof,
  DefectSeverity,
  DefectStatus,
} from "../mind/defects/core/index.ts";
import type { atomicWriteBytes } from "../core/durable-write.ts";

export type DeduplicationStrategy =
  | "aggregate_synchronous"
  | "exact_dedup"
  | "windowed"
  | "sliding_window_hash";

export interface LiveDeduplicationOptions {
  readonly strategy?: DeduplicationStrategy | undefined;
  readonly windowMs?: number | undefined;
  readonly maxEntries?: number | undefined;
  readonly maxOccurrences?: number | undefined;
  readonly maxOccurrencesTracked?: number | undefined;
  readonly keyOptions?: DefectKeyOptions | undefined;
  readonly onDefectDeduplicated?:
    | ((defect: AggregatedDefect, incoming: DefectRecordInput) => void)
    | undefined;
  readonly onNewDefect?: ((defect: AggregatedDefect) => void) | undefined;
}

export interface DefectLogOptions {
  readonly runRoot?: string | undefined;
  readonly targetDir?: string | undefined;
  readonly filePath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly deduplicate?: boolean | undefined;
  readonly strategy?: DeduplicationStrategy | undefined;
  readonly windowMs?: number | undefined;
  readonly maxOccurrencesTracked?: number | undefined;
  readonly keyOptions?: DefectKeyOptions | undefined;
}

export interface DefectLogResult {
  readonly recorded: AggregatedDefect;
  readonly isNew: boolean;
  readonly totalEntries: number;
  readonly filePath: string;
}

export interface StrictDefectLedgerEntry {
  readonly id: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly line: string;
}

export type DefectPromotionPersistenceStage =
  | "PREPARED"
  | "TARGET_DURABLE"
  | "SOURCE_DURABLE"
  | "COMMITTED";

export interface DefectPromotionJournal {
  readonly version: 1;
  readonly state: "PREPARED" | "COMMITTED";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly ids: readonly string[];
  readonly sourceHash: string;
  readonly targetHash: string;
}

export interface DefectLogDependencies {
  readonly atomicWrite: typeof atomicWriteBytes;
  readonly readFile: (filePath: string, encoding: "utf-8") => string;
}

export type {
  AggregatedDefect,
  DefectCategory,
  DefectEntry,
  DefectKeyOptions,
  DefectOccurrence,
  DefectRecordInput,
  DefectResolutionProof,
  DefectSeverity,
  DefectStatus,
};
