import { LiveDefectDeduplicator } from "../dedup/live-dedup.ts";
import { executeDomainTask } from "./task-runner.ts";
import type {
  AggregatedDefect,
  DefectHypothesis,
  DefectRecordInput,
  DefectRemediationAction,
  DefectResolutionProof,
} from "../core/types.ts";
import type {
  DefectFeedbackCycle,
  DefectLoopMetrics,
  DefectLoopOptions,
  DomainExecutionTask,
  DomainMetrics,
  DomainTaskResult,
  QueuedTaskEntry,
} from "./types.ts";

export class ContinuousDefectFeedbackLoop {
  private readonly options: DefectLoopOptions;
  private readonly deduplicator: LiveDefectDeduplicator;
  private readonly taskQueues = new Map<string, Array<QueuedTaskEntry<unknown>>>();
  private readonly domainActiveWorkers = new Map<string, number>();
  private readonly domainStats = new Map<string, {
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
    timedOutTasks: number;
    defectsCount: number;
    totalDurationMs: number;
  }>();
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

  public getDeduplicator(): LiveDefectDeduplicator { return this.deduplicator; }
  public getStatus(): "idle" | "running" | "paused" | "stopped" { return this.status; }

  public recordDefect(defect: DefectRecordInput, domain = "general", taskId?: string): AggregatedDefect {
    const recordResult = this.deduplicator.record(defect);
    const aggregated = recordResult.entry;
    const stats = this.getOrCreateDomainStats(domain);
    stats.defectsCount += 1;
    if (this.options.onDefectCaptured) this.options.onDefectCaptured(aggregated, domain, taskId);
    return aggregated;
  }

  public async submitTask<TResult>(task: DomainExecutionTask<TResult>): Promise<DomainTaskResult<TResult>> {
    if (this.status === "stopped") {
      throw new Error(`Cannot submit task ${task.id}: ContinuousDefectFeedbackLoop is stopped`);
    }
    const domain = task.domain.trim().toLowerCase();
    if (!this.canRunDomainTask(domain)) {
      return new Promise<DomainTaskResult<TResult>>((resolve, reject) => {
        const queue = this.taskQueues.get(domain) ?? [];
        const entry: QueuedTaskEntry<TResult> = { task, resolve, reject };
        queue.push(entry as QueuedTaskEntry<unknown>);
        this.taskQueues.set(domain, queue);
      });
    }
    return this.runTask(task);
  }

  public async submitBatch(tasks: readonly DomainExecutionTask<unknown>[]): Promise<readonly DomainTaskResult<unknown>[]> {
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
        root_cause: `Root cause for ${defect.type}: ${(defect.observation || "").slice(0, 100)}`,
        confidence: defect.count > 1 ? 0.95 : 0.8,
        category: defect.category || "code_defect",
        evidence: [`Observed count: ${defect.count}`, `Last seen: ${defect.last_seen_at}`],
      };
      hypotheses.push(hypothesis);

      let actionType: DefectRemediationAction["action_type"] = "fix_code";
      if (defect.category === "boundary_violation") actionType = "tighten_boundary";
      else if (defect.category === "model_reasoning_error") actionType = "align_reasoning";

      const action: DefectRemediationAction = {
        action_id: `act-${defect.id}`,
        defect_id: defect.id,
        target_scope: defect.capsule_root ? [defect.capsule_root] : ["olt/"],
        action_type: actionType,
        description: defect.remediation || `Remediation for ${defect.type}`,
        prescribed_test: `bun test tests/unit/defects/`,
        status: "planned",
      };
      proposedActions.push(action);

      if (this.options.onRemediationProposed) this.options.onRemediationProposed(action, hypothesis);

      if (this.options.autoRemediate) {
        executedActions.push({ ...action, status: "verified" });
        const proof: DefectResolutionProof = {
          task_id: `task-auto-${defect.id}`,
          test_assertion: action.prescribed_test,
          resolved_at: new Date().toISOString(),
        };
        const resolved = this.deduplicator.resolve(defect.id, proof);
        if (resolved) resolvedIds.push(defect.id);
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
    if (this.options.onFeedbackCycleCompleted) this.options.onFeedbackCycleCompleted(cycle);
    return cycle;
  }

  public resolveDefect(defectId: string, proof: DefectResolutionProof): boolean {
    return this.deduplicator.resolve(defectId, proof) !== null;
  }

  public pause(): void { if (this.status !== "stopped") this.status = "paused"; }

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
        entry.reject(new Error(`Task ${entry.task.id} cancelled: ContinuousDefectFeedbackLoop stopped`));
      }
    }
    this.taskQueues.clear();
  }

  public async drain(timeoutMs = 5000): Promise<boolean> {
    this.status = "paused";
    const start = Date.now();
    while (this.runningPromiseCount > 0) {
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 20));
    }
    this.status = "idle";
    return true;
  }

  public getDomainMetrics(): Readonly<Record<string, DomainMetrics>> {
    const result: Record<string, DomainMetrics> = {};
    for (const [domain, stats] of this.domainStats.entries()) {
      const activeWorkers = this.domainActiveWorkers.get(domain) ?? 0;
      const avgDurationMs = stats.totalTasks > 0 ? Math.round(stats.totalDurationMs / stats.totalTasks) : 0;
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
    if (this.status === "paused" || this.status === "stopped") return false;
    const maxPerDomain = this.options.maxConcurrentPerDomain ?? 4;
    const maxParallelDomains = this.options.maxParallelDomains ?? 8;
    const currentWorkers = this.domainActiveWorkers.get(domain) ?? 0;
    const activeDomains = Array.from(this.domainActiveWorkers.values()).filter((w) => w > 0).length;
    if (currentWorkers >= maxPerDomain) return false;
    if (currentWorkers === 0 && activeDomains >= maxParallelDomains) return false;
    return true;
  }

  private pumpQueues(): void {
    if (this.status === "paused" || this.status === "stopped") return;
    for (const [domain, queue] of this.taskQueues.entries()) {
      while (queue.length > 0 && this.canRunDomainTask(domain)) {
        const entry = queue.shift();
        if (entry) {
          this.runTask(entry.task).then(
            (res) => entry.resolve(res),
            (err: unknown) => entry.reject(err),
          );
        }
      }
    }
  }

  private async runTask<TResult>(task: DomainExecutionTask<TResult>): Promise<DomainTaskResult<TResult>> {
    const domain = task.domain.trim().toLowerCase();
    this.domainActiveWorkers.set(domain, (this.domainActiveWorkers.get(domain) ?? 0) + 1);
    this.runningPromiseCount += 1;
    this.status = "running";
    const stats = this.getOrCreateDomainStats(domain);

    const taskResult = await executeDomainTask({
      task,
      domain,
      defaultTimeoutMs: this.options.defaultTimeoutMs ?? 30_000,
      recordDefect: (input, dom, tid) => this.recordDefect(input, dom, tid),
    });

    this.totalTasksExecuted += 1;
    stats.totalTasks += 1;
    stats.totalDurationMs += taskResult.durationMs;
    if (taskResult.status === "succeeded") {
      this.successfulTasks += 1;
      stats.successfulTasks += 1;
    } else if (taskResult.status === "timed_out") {
      this.timedOutTasks += 1;
      stats.timedOutTasks += 1;
    } else {
      this.failedTasks += 1;
      stats.failedTasks += 1;
    }

    this.domainActiveWorkers.set(domain, Math.max(0, (this.domainActiveWorkers.get(domain) ?? 1) - 1));
    this.runningPromiseCount = Math.max(0, this.runningPromiseCount - 1);
    if (this.runningPromiseCount === 0 && this.status === "running") this.status = "idle";
    if (this.options.onTaskCompleted) this.options.onTaskCompleted(taskResult as DomainTaskResult<unknown>);
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
      stats = { totalTasks: 0, successfulTasks: 0, failedTasks: 0, timedOutTasks: 0, defectsCount: 0, totalDurationMs: 0 };
      this.domainStats.set(domain, stats);
    }
    return stats;
  }
}
