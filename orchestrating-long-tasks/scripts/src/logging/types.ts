import type {
  AggregatedBlunder,
  BlunderKeyOptions,
  DeduplicationStrategy,
  LiveDeduplicationOptions,
} from "../blunders/types.ts";

export interface BlunderLogOptions {
  readonly runRoot?: string | undefined;
  readonly targetDir?: string | undefined;
  readonly filePath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly deduplicate?: boolean | undefined;
  readonly strategy?: DeduplicationStrategy | undefined;
  readonly windowMs?: number | undefined;
  readonly maxOccurrencesTracked?: number | undefined;
  readonly keyOptions?: BlunderKeyOptions | undefined;
}

export interface BlunderLogResult {
  readonly recorded: AggregatedBlunder;
  readonly isNew: boolean;
  readonly totalEntries: number;
  readonly filePath: string;
}

export type { LiveDeduplicationOptions };
