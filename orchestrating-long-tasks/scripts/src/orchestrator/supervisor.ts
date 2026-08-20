import { workflowPort } from "../integration/store-ports.ts";
import { loadRun } from "../store/index.ts";
import { systemClock, type Clock, type WorkflowState } from "../workflow/types.ts";
import { escalateTask } from "../workflow/lease/escalate.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { selectDispatchable, type BackingOffTask } from "./dispatch-selection.ts";
import { recordDispatchOutcome, readDispatchHistory, type DispatchLogEvent } from "./dispatch-log.ts";
import { classifyFailure, nextBackoffDelayMs, type BackoffConfig, type FailureSignal } from "./failure-classifier.ts";
import { buildMorningReport, type MorningReport } from "./morning-report.ts";
import { runSupervisionTick, type EscalationRecord } from "./supervision-tick.ts";
import type { ReadyEntry } from "../scheduler/index.ts";
import type { DeadAgentEvent } from "./dead-agent-detector.ts";

/**
 * What dispatching a task actually means is host work (spawning and running a real agent, R9/B14):
 * the harness never does it itself. `RunSupervisor` drives the decision loop and hands each
 * dispatchable task to whatever the host injects here, exactly the seam `AutonomousLoopRunner`
 * already uses for round execution.
 */
export interface TaskDispatchInput {
  readonly taskId: string;
  readonly writeScope: readonly string[];
  readonly priority: number;
}

export interface TaskDispatchFailure {
  readonly signal: FailureSignal;
  readonly detail: string;
}

export interface TaskDispatchResult {
  readonly status: "dispatched" | "failed";
  readonly agentId?: string;
  readonly failure?: TaskDispatchFailure;
}

export interface TaskDispatcher {
  dispatch(input: TaskDispatchInput): Promise<TaskDispatchResult>;
}

export type SupervisorStopReason =
  | "terminal"
  | "stalled"
  | "elapsed_budget_exhausted"
  | "single_tick";

export interface RunSupervisorOptions {
  readonly runRoot: string;
  readonly actor: string;
  readonly maxParallel: number;
  /** Absent: the supervisor still reclaims, escalates and reports, but dispatches nothing itself. */
  readonly dispatcher?: TaskDispatcher;
  /** B28.5: recovery is on by default. A caller must explicitly opt out, never the reverse. */
  readonly recoveryEnabled?: boolean;
  readonly graceSeconds?: number;
  readonly deterministicRepeatThreshold?: number;
  /** Per-task retry elapsed budget (B28.3). Assumed default: see `failure-classifier.ts`. */
  readonly maxElapsedMsPerTask?: number;
  readonly backoff?: BackoffConfig;
  /** How often to re-tick while waiting for a dispatcher's work to land. Assumed, not measured. */
  readonly pollIntervalMs?: number;
  /** The whole run's wall-clock budget — "the entire night" (B28's own framing). Assumed. */
  readonly maxTotalElapsedMs?: number;
  readonly clock?: Clock;
  /** Injectable so tests never actually wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** One combined reclaim-escalate-dispatch pass, folding both halves of `supervision-tick.ts` back together. */
export interface SupervisorTickOutcome {
  readonly reclaimed: readonly DeadAgentEvent[];
  readonly escalatedNow: readonly EscalationRecord[];
  readonly dispatchable: readonly ReadyEntry[];
  readonly backingOff: readonly BackingOffTask[];
  readonly occupied: number;
  readonly maxParallel: number;
}

export interface SupervisionRunResult {
  readonly stopReason: SupervisorStopReason;
  readonly ticks: number;
  readonly lastTick: SupervisorTickOutcome;
  readonly report: MorningReport;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_TOTAL_ELAPSED_MS = 8 * 60 * 60_000;

function isRunTerminal(state: WorkflowState): boolean {
  if (state.completion_result !== undefined) return true;
  const tasks = Object.values(state.tasks);
  return tasks.length > 0 && tasks.every((task) => ["done", "cancelled", "escalated"].includes(task.status));
}

export class RunSupervisor {
  private readonly port: ReturnType<typeof workflowPort>;
  private readonly clock: Clock;
  private readonly sleepFn: (ms: number) => Promise<void>;

  public constructor(private readonly options: RunSupervisorOptions) {
    this.port = workflowPort(options.runRoot);
    this.clock = options.clock ?? systemClock;
    this.sleepFn = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Both halves the module comment in `supervision-tick.ts` describes: `.state` and `.events`. */
  private load(): ReturnType<typeof loadRun> {
    return loadRun(this.options.runRoot);
  }

  /** One reclaim-escalate-dispatch pass. Safe to call repeatedly and safe to call after a restart. */
  private async tick(): Promise<SupervisorTickOutcome> {
    const o = this.options;
    const reclaim = runSupervisionTick(this.port, o.actor, {
      clock: this.clock,
      ...(o.recoveryEnabled === undefined ? {} : { recoveryEnabled: o.recoveryEnabled }),
      ...(o.graceSeconds === undefined ? {} : { graceSeconds: o.graceSeconds }),
      ...(o.deterministicRepeatThreshold === undefined
        ? {}
        : { deterministicRepeatThreshold: o.deterministicRepeatThreshold }),
      ...(o.maxElapsedMsPerTask === undefined ? {} : { maxElapsedMs: o.maxElapsedMsPerTask }),
    });

    // Fresh load, taken AFTER the reclaim/escalation mutations above, so a task just escalated
    // cannot still read as ready.
    const loaded = this.load();
    const freeSlots = Math.max(0, o.maxParallel - reclaim.occupied);
    const selection = selectDispatchable(loaded.state, loaded.events, freeSlots, this.clock.now());

    const outcome: SupervisorTickOutcome = {
      reclaimed: reclaim.reclaimed,
      escalatedNow: reclaim.escalatedNow,
      dispatchable: selection.dispatchable,
      backingOff: selection.backingOff,
      occupied: reclaim.occupied,
      maxParallel: o.maxParallel,
    };
    if (o.dispatcher !== undefined) await this.dispatchReady(outcome, loaded.events);
    return outcome;
  }

  private async dispatchReady(
    tick: SupervisorTickOutcome,
    events: readonly DispatchLogEvent[],
  ): Promise<void> {
    const dispatcher = this.options.dispatcher;
    if (dispatcher === undefined) return;
    for (const entry of tick.dispatchable) {
      const result = await dispatcher.dispatch({
        taskId: entry.task_id,
        writeScope: entry.write_scope,
        priority: entry.priority,
      });
      if (result.status === "dispatched") {
        recordDispatchOutcome(this.port, this.options.actor, {
          taskId: entry.task_id,
          outcome: "dispatched",
          ...(result.agentId === undefined ? {} : { agentId: result.agentId }),
        });
        continue;
      }
      this.recordAndClassifyFailure(entry.task_id, result.failure, events);
    }
  }

  private recordAndClassifyFailure(
    taskId: string,
    failure: TaskDispatchFailure | undefined,
    events: readonly DispatchLogEvent[],
  ): void {
    const now = this.clock.now();
    // "unknown" for both: the dispatcher reported a bare failure with no structured reason, and
    // that absence is the fact worth recording — never a guessed explanation standing in for it.
    const signal = failure?.signal ?? "unknown";
    const detail = failure?.detail ?? "unknown";
    const history = readDispatchHistory(events, taskId);
    const classification = classifyFailure({
      signal,
      detail,
      priorFailures: history.failures,
      now,
      ...(this.options.deterministicRepeatThreshold === undefined
        ? {}
        : { deterministicRepeatThreshold: this.options.deterministicRepeatThreshold }),
      ...(this.options.maxElapsedMsPerTask === undefined
        ? {}
        : { maxElapsedMs: this.options.maxElapsedMsPerTask }),
    });
    if (classification.failureClass === "transient") {
      const delayMs = nextBackoffDelayMs(classification.repeatCount, this.options.backoff);
      const retryAt = new Date(now.valueOf() + delayMs).toISOString();
      recordDispatchOutcome(this.port, this.options.actor, {
        taskId,
        outcome: "failed",
        failure: { signal, detail },
        classification,
        retryAt,
      });
      return;
    }
    recordDispatchOutcome(this.port, this.options.actor, {
      taskId,
      outcome: "failed",
      failure: { signal, detail },
      classification,
    });
    try {
      escalateTask(
        this.port,
        taskId,
        this.options.actor,
        "deterministic_failure",
        `${classification.reason} (dispatch attempt ${classification.repeatCount})`,
        this.clock,
      );
    } catch (error) {
      if (!(error instanceof HarnessError) || error.code !== "INVALID_STATE") throw error;
    }
  }

  private report(): MorningReport {
    const loaded = this.load();
    return buildMorningReport(this.port.read(), loaded.events, this.clock.now());
  }

  /**
   * Drives ticks to a terminal state (B28.2). Without a dispatcher this performs exactly one tick —
   * there is nothing to wait on — which is also what makes the command safe to run from an external
   * poll loop (cron, a shell `while`) instead of holding a process open all night.
   */
  public async run(): Promise<SupervisionRunResult> {
    const startedAt = this.clock.now().valueOf();
    const maxTotalElapsedMs = this.options.maxTotalElapsedMs ?? DEFAULT_MAX_TOTAL_ELAPSED_MS;
    const pollIntervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    let ticks = 0;
    let last = await this.tick();
    ticks += 1;

    if (this.options.dispatcher === undefined) {
      return { stopReason: "single_tick", ticks, lastTick: last, report: this.report() };
    }

    for (;;) {
      const state = this.port.read();
      if (isRunTerminal(state)) {
        return { stopReason: "terminal", ticks, lastTick: last, report: this.report() };
      }
      if (this.clock.now().valueOf() - startedAt >= maxTotalElapsedMs) {
        return { stopReason: "elapsed_budget_exhausted", ticks, lastTick: last, report: this.report() };
      }
      const stuck =
        last.dispatchable.length === 0 && last.occupied === 0 && last.backingOff.length === 0;
      if (stuck) {
        return { stopReason: "stalled", ticks, lastTick: last, report: this.report() };
      }
      let soonestRetry: number | undefined;
      for (const task of last.backingOff) {
        const at = Date.parse(task.retryAt);
        soonestRetry = soonestRetry === undefined ? at : Math.min(soonestRetry, at);
      }
      const wait =
        soonestRetry === undefined
          ? pollIntervalMs
          : Math.max(0, Math.min(pollIntervalMs, soonestRetry - this.clock.now().valueOf()));
      await this.sleepFn(wait);
      last = await this.tick();
      ticks += 1;
    }
  }
}
