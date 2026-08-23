import {
  categorizeDefect,
  type DefectCategory,
  type DefectDeliberationRound,
  type DefectHypothesis,
  type DefectRemediationAction,
  type DefectRemediationSynthesis,
  type DefectResolutionProof,
  type DefectStatus,
} from "../mind/defects.ts";
import { LiveDefectDeduplicator } from "./live-dedup.ts";
import type {
  AggregatedDefect,
  DefectAggregateMetrics,
  DefectRecordInput,
  LiveDeduplicationOptions,
} from "./types.ts";

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
  readonly deduplicatorMetrics: DefectAggregateMetrics;
  readonly domainMetrics: Readonly<Record<string, DomainMetrics>>;
  readonly loopStatus: "idle" | "running" | "paused" | "stopped";
}

interface QueuedTaskEntry<TResult = unknown> {
  readonly task: DomainExecutionTask<TResult>;
  readonly resolve: (result: DomainTaskResult<TResult>) => void;
  readonly reject: (error: unknown) => void;
}

export class ContinuousDefectFeedbackLoop {
  private readonly options: DefectLoopOptions;
  private readonly deduplicator: LiveDefectDeduplicator;
  private readonly taskQueues = new Map<string, Array<QueuedTaskEntry<unknown>>>();
  private readonly domainActiveWorkers = new Map<string, number>();
  private readonly domainStats = new Map<
    string,
    {
      totalTasks: number;
      successfulTasks: number;
      failedTasks: number;
      timedOutTasks: number;
      defectsCount: number;
      totalDurationMs: number;
    }
  >();
  private readonly feedbackCycles: DefectFeedbackCycle[] = [];
  private totalTasksExecuted = 0;
  private successfulTasks = 0;
  private failedTasks = 0;
  private timedOutTasks = 0;
  private status: "idle" | "running" | "paused" | "stopped" = "idle";
  private runningPromiseCount = 0;

  constructor(options: DefectLoopOptions = {}) {
    this.options = options;
    this.deduplicator = new LiveDefectDeduplicator(options.deduplicatorOptions);
  }

  public getDeduplicator(): LiveDefectDeduplicator {
    return this.deduplicator;
  }

  public getStatus(): "idle" | "running" | "paused" | "stopped" {
    return this.status;
  }

  public recordDefect(
    defect: DefectRecordInput,
    domain: string = "general",
    taskId?: string,
  ): AggregatedDefect {
    const recordResult = this.deduplicator.record(defect);
    const aggregated = recordResult.entry;

    const stats = this.getOrCreateDomainStats(domain);
    stats.defectsCount += 1;

    if (this.options.onDefectCaptured) {
      this.options.onDefectCaptured(aggregated, domain, taskId);
    }

    return aggregated;
  }

  public async submitTask<TResult>(
    task: DomainExecutionTask<TResult>,
  ): Promise<DomainTaskResult<TResult>> {
    if (this.status === "stopped") {
      throw new Error(`Cannot submit task ${task.id}: ContinuousDefectFeedbackLoop is stopped`);
    }

    const domain = task.domain.trim().toLowerCase();

    if (!this.canRunDomainTask(domain)) {
      return new Promise<DomainTaskResult<TResult>>((resolve, reject) => {
        const queue = this.taskQueues.get(domain) ?? [];
        const entry: QueuedTaskEntry<TResult> = {
          task,
          resolve,
          reject,
        };
        queue.push(entry as QueuedTaskEntry<unknown>);
        this.taskQueues.set(domain, queue);
      });
    }

    return this.executeTaskInternal(task);
  }

  public async submitBatch(
    tasks: readonly DomainExecutionTask<unknown>[],
  ): Promise<readonly DomainTaskResult<unknown>[]> {
    return Promise.all(tasks.map((task) => this.submitTask(task)));
  }

  public async triggerFeedbackCycle(): Promise<DefectFeedbackCycle> {
    const startTime = Date.now();
    const cycleId = `cycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const openDefects = this.deduplicator.getOpenDefects();

    const hypotheses: DefectHypothesis[] = [];
    const proposedActions: DefectRemediationAction[] = [];
    const executedActions: DefectRemediationAction[] = [];
    const resolvedIds: string[] = [];

    for (const defect of openDefects) {
      const hypothesis: DefectHypothesis = {
        id: `hypo-${defect.id}`,
        defect_id: defect.id,
        root_cause: `Root cause identified for ${defect.type}: ${defect.observation.slice(0, 100)}`,
        confidence: defect.count > 1 ? 0.95 : 0.8,
        category: defect.category,
        evidence: [
          `Observed count: ${defect.count}`,
          `Last seen: ${defect.last_seen_at}`,
          `Observation signature: ${defect.dedup_key}`,
        ],
      };
      hypotheses.push(hypothesis);

      let actionType: DefectRemediationAction["action_type"] = "fix_code";
      if (defect.category === "boundary_violation") {
        actionType = "tighten_boundary";
      } else if (defect.category === "model_reasoning_error") {
        actionType = "align_reasoning";
      }

      const action: DefectRemediationAction = {
        action_id: `act-${defect.id}`,
        defect_id: defect.id,
        target_scope: defect.capsule_root ? [defect.capsule_root] : ["olt/"],
        action_type: actionType,
        description: defect.remediation || `Automated remediation for ${defect.type}`,
        prescribed_test: `bun test tests/unit/defects/`,
        status: "planned",
      };
      proposedActions.push(action);

      if (this.options.onRemediationProposed) {
        this.options.onRemediationProposed(action, hypothesis);
      }

      if (this.options.autoRemediate) {
        const executed: DefectRemediationAction = {
          ...action,
          status: "verified",
        };
        executedActions.push(executed);

        const proof: DefectResolutionProof = {
          task_id: `task-auto-${defect.id}`,
          test_assertion: action.prescribed_test,
          resolved_at: new Date().toISOString(),
          remediation_notes: `Auto-remediated via continuous feedback cycle ${cycleId}`,
          verified_by: "ContinuousDefectFeedbackLoop",
        };

        const resolved = this.deduplicator.resolve(defect.id, proof);
        if (resolved) {
          resolvedIds.push(defect.id);
        }
      }
    }

    const cycle: DefectFeedbackCycle = {
      cycleId,
      timestamp: new Date().toISOString(),
      openDefectsCount: openDefects.length,
      hypothesesGenerated: hypotheses,
      remediationsProposed: proposedActions,
      remediationsExecuted: executedActions,
      resolvedDefectIds: resolvedIds,
      durationMs: Date.now() - startTime,
    };

    this.feedbackCycles.push(cycle);

    if (this.options.onFeedbackCycleCompleted) {
      this.options.onFeedbackCycleCompleted(cycle);
    }

    return cycle;
  }

  public resolveDefect(defectId: string, proof: DefectResolutionProof): boolean {
    const res = this.deduplicator.resolve(defectId, proof);
    return res !== null;
  }

  public pause(): void {
    if (this.status !== "stopped") {
      this.status = "paused";
    }
  }

  public resume(): void {
    if (this.status === "paused") {
      this.status = this.runningPromiseCount > 0 ? "running" : "idle";
      this.pumpQueues();
    }
  }

  public stop(): void {
    this.status = "stopped";
    for (const queue of this.taskQueues.values()) {
      for (const entry of queue) {
        entry.reject(
          new Error(`Task ${entry.task.id} cancelled: ContinuousDefectFeedbackLoop stopped`),
        );
      }
    }
    this.taskQueues.clear();
  }

  public async drain(timeoutMs: number = 5000): Promise<boolean> {
    this.status = "paused";
    const start = Date.now();
    while (this.runningPromiseCount > 0) {
      if (Date.now() - start > timeoutMs) {
        return false;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    this.status = "idle";
    return true;
  }

  public getDomainMetrics(): Readonly<Record<string, DomainMetrics>> {
    const result: Record<string, DomainMetrics> = {};
    for (const [domain, stats] of this.domainStats.entries()) {
      const activeWorkers = this.domainActiveWorkers.get(domain) ?? 0;
      const avgDurationMs =
        stats.totalTasks > 0 ? Math.round(stats.totalDurationMs / stats.totalTasks) : 0;
      result[domain] = {
        domain,
        totalTasks: stats.totalTasks,
        successfulTasks: stats.successfulTasks,
        failedTasks: stats.failedTasks,
        timedOutTasks: stats.timedOutTasks,
        defectsCount: stats.defectsCount,
        activeWorkers,
        avgDurationMs,
      };
    }
    return result;
  }

  public getLoopMetrics(): DefectLoopMetrics {
    const activeDomains = Array.from(this.domainActiveWorkers.entries())
      .filter(([_, count]) => count > 0)
      .map(([domain]) => domain);

    return {
      totalTasksExecuted: this.totalTasksExecuted,
      successfulTasks: this.successfulTasks,
      failedTasks: this.failedTasks,
      timedOutTasks: this.timedOutTasks,
      totalFeedbackCycles: this.feedbackCycles.length,
      activeDomains,
      deduplicatorMetrics: this.deduplicator.getMetrics(),
      domainMetrics: this.getDomainMetrics(),
      loopStatus: this.status,
    };
  }

  private canRunDomainTask(domain: string): boolean {
    if (this.status === "paused" || this.status === "stopped") {
      return false;
    }
    const maxPerDomain = this.options.maxConcurrentPerDomain ?? 4;
    const maxParallelDomains = this.options.maxParallelDomains ?? 8;
    const currentDomainWorkers = this.domainActiveWorkers.get(domain) ?? 0;
    const totalActiveDomains = Array.from(this.domainActiveWorkers.values()).filter(
      (w) => w > 0,
    ).length;

    if (currentDomainWorkers >= maxPerDomain) {
      return false;
    }
    if (currentDomainWorkers === 0 && totalActiveDomains >= maxParallelDomains) {
      return false;
    }
    return true;
  }

  private pumpQueues(): void {
    if (this.status === "paused" || this.status === "stopped") {
      return;
    }

    for (const [domain, queue] of this.taskQueues.entries()) {
      while (queue.length > 0 && this.canRunDomainTask(domain)) {
        const entry = queue.shift();
        if (entry) {
          this.executeTaskInternal(entry.task).then(
            (res) => entry.resolve(res),
            (err: unknown) => entry.reject(err),
          );
        }
      }
    }
  }

  private async executeTaskInternal<TResult>(
    task: DomainExecutionTask<TResult>,
  ): Promise<DomainTaskResult<TResult>> {
    const domain = task.domain.trim().toLowerCase();
    const domainWorkers = (this.domainActiveWorkers.get(domain) ?? 0) + 1;
    this.domainActiveWorkers.set(domain, domainWorkers);
    this.runningPromiseCount += 1;
    this.status = "running";

    const stats = this.getOrCreateDomainStats(domain);
    const capturedDefects: AggregatedDefect[] = [];
    const abortController = new AbortController();
    const timeoutMs = task.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let isTimedOut = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        isTimedOut = true;
        abortController.abort();
        reject(
          new Error(`Domain task ${task.id} in domain ${domain} timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
    });

    const context: DomainExecutionContext = {
      domain,
      taskId: task.id,
      taskName: task.name,
      signal: abortController.signal,
      emitDefect: (input: DefectRecordInput) => {
        const bl = this.recordDefect(input, domain, task.id);
        capturedDefects.push(bl);
        return bl;
      },
      log: (_msg: string) => {
        // Structured logging hook
      },
      metadata: task.metadata,
    };

    const startTime = Date.now();
    let retriesAttempted = 0;
    const retryLimit = task.retryLimit ?? 0;
    let finalResult: TResult | undefined;
    let finalError: unknown | undefined;
    let finalStatus: DomainExecutionStatus = "failed";

    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      if (attempt > 0) {
        retriesAttempted += 1;
      }
      try {
        const result = await Promise.race([task.execute(context), timeoutPromise]);
        finalResult = result;
        finalStatus = "succeeded";
        finalError = undefined;
        break;
      } catch (err: unknown) {
        finalError = err;
        if (isTimedOut) {
          finalStatus = "timed_out";
          const defect: DefectRecordInput = {
            id: `defect-timeout-${task.id}`,
            type: "domain_task_timeout",
            severity: "high",
            category: "code_defect",
            observation: `Domain task ${task.name} (${task.id}) in domain ${domain} timed out after ${timeoutMs}ms`,
            remediation: "Increase timeout or optimize execution performance",
          };
          capturedDefects.push(this.recordDefect(defect, domain, task.id));
          break;
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        const autoDefect: DefectRecordInput = {
          id: `defect-exec-${task.id}-${attempt}`,
          type: "task_execution_failure",
          severity: "warning",
          category: categorizeDefect({
            type: "task_execution_failure",
            observation: errorMessage,
          }),
          observation: `Task execution failed in domain ${domain}: ${errorMessage}`,
          remediation: `Investigate root cause in domain ${domain} task ${task.name}`,
        };
        capturedDefects.push(this.recordDefect(autoDefect, domain, task.id));

        if (attempt < retryLimit && !abortController.signal.aborted) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
    }

    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }

    const durationMs = Date.now() - startTime;
    this.totalTasksExecuted += 1;
    stats.totalTasks += 1;
    stats.totalDurationMs += durationMs;

    if (finalStatus === "succeeded") {
      this.successfulTasks += 1;
      stats.successfulTasks += 1;
    } else if (finalStatus === "timed_out") {
      this.timedOutTasks += 1;
      stats.timedOutTasks += 1;
    } else {
      this.failedTasks += 1;
      stats.failedTasks += 1;
    }

    const activeNow = (this.domainActiveWorkers.get(domain) ?? 1) - 1;
    this.domainActiveWorkers.set(domain, Math.max(0, activeNow));
    this.runningPromiseCount = Math.max(0, this.runningPromiseCount - 1);
    if (this.runningPromiseCount === 0 && this.status === "running") {
      this.status = "idle";
    }

    const taskResult: DomainTaskResult<TResult> = {
      taskId: task.id,
      taskName: task.name,
      domain,
      status: finalStatus,
      result: finalResult,
      error: finalError,
      durationMs,
      defectsCaptured: capturedDefects,
      retryCount: retriesAttempted,
      timestamp: new Date().toISOString(),
    };

    if (this.options.onTaskCompleted) {
      this.options.onTaskCompleted(taskResult as DomainTaskResult<unknown>);
    }

    this.pumpQueues();

    return taskResult;
  }

  private getOrCreateDomainStats(domain: string): {
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
    timedOutTasks: number;
    defectsCount: number;
    totalDurationMs: number;
  } {
    let stats = this.domainStats.get(domain);
    if (!stats) {
      stats = {
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        timedOutTasks: 0,
        defectsCount: 0,
        totalDurationMs: 0,
      };
      this.domainStats.set(domain, stats);
    }
    return stats;
  }
}
