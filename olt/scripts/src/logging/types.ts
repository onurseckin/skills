import type {
  AggregatedDefect,
  DefectKeyOptions,
  DeduplicationStrategy,
  LiveDeduplicationOptions,
} from "../mind/defects/types.ts";

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

export type { LiveDeduplicationOptions };
