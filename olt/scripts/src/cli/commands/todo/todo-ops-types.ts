import type { CompletedTaskRecord } from "../../../mind/archival/completed/index.ts";
import type { FeedbackItem, FeedbackQueueStats } from "../../../mind/feedback/queue/index.ts";

export interface TodoListResult {
  readonly markdown: string;
  readonly count: number;
  readonly total: number;
  readonly filteredCount: number;
  readonly stats: FeedbackQueueStats;
  readonly items: readonly FeedbackItem[];
  readonly [key: string]: unknown;
}

export interface TodoAddResult {
  readonly markdown: string;
  readonly item: FeedbackItem;
  readonly [key: string]: unknown;
}

export interface TodoDrainResult {
  readonly markdown: string;
  readonly drainedCount: number;
  readonly items: readonly FeedbackItem[];
  readonly item?: FeedbackItem | undefined;
  readonly [key: string]: unknown;
}

export interface TodoSealResult {
  readonly markdown: string;
  readonly item: FeedbackItem;
  readonly sealed: boolean;
  readonly [key: string]: unknown;
}

export interface TodoCleanResult {
  readonly markdown: string;
  readonly cleanedCount: number;
  readonly remainingCount: number;
  readonly archived: readonly CompletedTaskRecord[];
  readonly dryRun: boolean;
  readonly [key: string]: unknown;
}
