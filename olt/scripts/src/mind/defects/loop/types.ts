import type {
  AggregatedDefect,
  DefectCategory,
  DefectHypothesis,
  DefectRecordInput,
  DefectRemediationAction,
  DefectResolutionProof,
  LiveDeduplicationOptions,
} from "../core/types.ts";
import type { DefectMetricsResult } from "../aggregator/metrics.ts";

export type DomainExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";

export interface DomainExecutionContext {
  readonly domain: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly signal: AbortSignal;
  readonly emitDefect: (defect: DefectRecordInput) => AggregatedDefect;
  readonly log: (message: string) => void;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface DomainExecutionTask<TResult = unknown> {
  readonly id: string;
  readonly domain: string;
  readonly name: string;
  readonly priority?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retryLimit?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly execute: (context: DomainExecutionContext) => Promise<TResult> | TResult;
}

export interface DomainTaskResult<TResult = unknown> {
  readonly taskId: string;
  readonly taskName: string;
  readonly domain: string;
  readonly status: DomainExecutionStatus;
  readonly result?: TResult | undefined;
  readonly error?: Error | string | unknown | undefined;
  readonly durationMs: number;
  readonly defectsCaptured: readonly AggregatedDefect[];
  readonly retryCount: number;
  readonly timestamp: string;
}

export interface DomainMetrics {
  readonly domain: string;
  readonly totalTasks: number;
  readonly successfulTasks: number;
  readonly failedTasks: number;
  readonly timedOutTasks: number;
  readonly defectsCount: number;
  readonly activeWorkers: number;
  readonly avgDurationMs: number;
}

export interface DefectFeedbackCycle {
  readonly cycleId: string;
  readonly timestamp: string;
  readonly openDefectsCount: number;
  readonly hypothesesGenerated: readonly DefectHypothesis[];
  readonly remediationsProposed: readonly DefectRemediationAction[];
  readonly remediationsExecuted: readonly DefectRemediationAction[];
  readonly resolvedDefectIds: readonly string[];
  readonly durationMs: number;
}

export interface DefectLoopOptions {
  readonly maxParallelDomains?: number | undefined;
  readonly maxConcurrentPerDomain?: number | undefined;
  readonly defaultTimeoutMs?: number | undefined;
  readonly deduplicatorOptions?: LiveDeduplicationOptions | undefined;
  readonly autoRemediate?: boolean | undefined;
  readonly maxFeedbackCycles?: number | undefined;
  readonly onDefectCaptured?:
    | ((defect: AggregatedDefect, domain: string, taskId?: string) => void)
    | undefined;
  readonly onRemediationProposed?:
    | ((action: DefectRemediationAction, hypothesis: DefectHypothesis) => void)
    | undefined;
  readonly onFeedbackCycleCompleted?: ((cycle: DefectFeedbackCycle) => void) | undefined;
  readonly onTaskCompleted?: ((result: DomainTaskResult<unknown>) => void) | undefined;
}

export interface DefectLoopMetrics {
  readonly totalTasksExecuted: number;
  readonly successfulTasks: number;
  readonly failedTasks: number;
  readonly timedOutTasks: number;
  readonly totalFeedbackCycles: number;
  readonly activeDomains: readonly string[];
  readonly deduplicatorMetrics: DefectMetricsResult;
  readonly domainMetrics: Readonly<Record<string, DomainMetrics>>;
  readonly loopStatus: "idle" | "running" | "paused" | "stopped";
}

export interface QueuedTaskEntry<TResult = unknown> {
  readonly task: DomainExecutionTask<TResult>;
  readonly resolve: (result: DomainTaskResult<TResult>) => void;
  readonly reject: (error: unknown) => void;
}
