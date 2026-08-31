import { workflowPort } from "../integration/store-ports.ts";
import { loadRun } from "../engine/store/index.ts";
import { findRepoRoot } from "../core/shared/paths.ts";
import { systemClock, type Clock } from "../workflow/types.ts";
import { escalateTask } from "../workflow/lease/escalate.ts";
import { HarnessError } from "../core/errors/index.ts";
import { OrchestratorCompanionAuditor } from "./companion-auditor.ts";
import { selectDispatchable, type BackingOffTask } from "./dispatch-selection.ts";
import {
  recordDispatchOutcome,
  readDispatchHistory,
  type DispatchLogEvent,
} from "./dispatch-log.ts";
import {
  classifyFailure,
  nextBackoffDelayMs,
  type BackoffConfig,
  type FailureSignal,
} from "./failure-classifier.ts";
import { buildMorningReport, type MorningReport } from "./morning-report.ts";
import { isRunTerminal } from "./run-terminal.ts";
import {
  runSupervisionTick,
  type ChangesRequestedTask,
  type EscalationRecord,
} from "./supervision-tick.ts";
import type { ReadyEntry } from "../engine/scheduler/index.ts";
import type { DeadAgentEvent } from "./dead-agent-detector.ts";
import type { BehavioralForensicsReport, CompanionPairingResult } from "./types.ts";

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
  readonly gateMaxParallel?: number;
  readonly dispatcher?: TaskDispatcher;
  readonly recoveryEnabled?: boolean;
  readonly graceSeconds?: number;
  readonly deterministicRepeatThreshold?: number;
  readonly maxElapsedMsPerTask?: number;
  readonly backoff?: BackoffConfig;
  readonly pollIntervalMs?: number;
  readonly maxTotalElapsedMs?: number;
  readonly clock?: Clock;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly skillAuditorCompanion?: boolean | undefined;
  readonly strictAuditorPolicy?: boolean | undefined;
}

export interface SupervisorTickOutcome {
  readonly reclaimed: readonly DeadAgentEvent[];
  readonly escalatedNow: readonly EscalationRecord[];
  readonly changesRequested: readonly ChangesRequestedTask[];
  readonly dispatchable: readonly ReadyEntry[];
  readonly backingOff: readonly BackingOffTask[];
  readonly occupied: number;
  readonly maxParallel: number;
  readonly gateMaxParallel?: number;
  readonly behavioralForensics?: BehavioralForensicsReport | undefined;
}

export interface SupervisionRunResult {
  readonly stopReason: SupervisorStopReason;
  readonly ticks: number;
  readonly lastTick: SupervisorTickOutcome;
  readonly report: MorningReport;
  readonly companionPairing?: CompanionPairingResult | undefined;
  readonly behavioralForensicsSummary?: BehavioralForensicsReport | undefined;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_TOTAL_ELAPSED_MS = 8 * 60 * 60_000;

export class RunSupervisor {
  private readonly port: ReturnType<typeof workflowPort>;
  private readonly clock: Clock;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly repoRoot: string;
  private sessionReclaimedCount = 0;

  public constructor(private readonly options: RunSupervisorOptions) {
    this.port = workflowPort(options.runRoot);
    this.clock = options.clock ?? systemClock;
    this.sleepFn = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.repoRoot = findRepoRoot(options.runRoot);
  }

  private load(): ReturnType<typeof loadRun> {
    return loadRun(this.options.runRoot);
  }

  private async tick(): Promise<SupervisorTickOutcome> {
    const o = this.options;
    const reclaim = runSupervisionTick(this.port, o.actor, {
      clock: this.clock,
      ...(o.recoveryEnabled !== undefined ? { recoveryEnabled: o.recoveryEnabled } : {}),
      ...(o.graceSeconds !== undefined ? { graceSeconds: o.graceSeconds } : {}),
      ...(o.deterministicRepeatThreshold !== undefined
        ? { deterministicRepeatThreshold: o.deterministicRepeatThreshold }
        : {}),
      ...(o.maxElapsedMsPerTask !== undefined ? { maxElapsedMs: o.maxElapsedMsPerTask } : {}),
    });
    this.sessionReclaimedCount += reclaim.reclaimed.length;

    const loaded = this.load();
    const freeSlots = Math.max(0, o.maxParallel - reclaim.occupied);
    const selection = selectDispatchable(loaded.state, loaded.events, freeSlots, this.clock.now());

    const behavioralForensics = OrchestratorCompanionAuditor.executeForensics(this.repoRoot, {
      capsuleRunRoot: this.options.runRoot,
      now: this.clock.now().toISOString(),
    });

    const outcome: SupervisorTickOutcome = {
      reclaimed: reclaim.reclaimed,
      escalatedNow: reclaim.escalatedNow,
      changesRequested: reclaim.changesRequested,
      dispatchable: selection.dispatchable,
      backingOff: selection.backingOff,
      occupied: reclaim.occupied,
      maxParallel: o.maxParallel,
      behavioralForensics,
      ...(o.gateMaxParallel !== undefined ? { gateMaxParallel: o.gateMaxParallel } : {}),
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
          ...(result.agentId !== undefined ? { agentId: result.agentId } : {}),
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
    const signal = failure?.signal ?? "unknown";
    const detail = failure?.detail ?? "unknown";
    const history = readDispatchHistory(events, taskId);
    const classification = classifyFailure({
      signal,
      detail,
      priorFailures: history.failures,
      now,
      ...(this.options.deterministicRepeatThreshold !== undefined
        ? { deterministicRepeatThreshold: this.options.deterministicRepeatThreshold }
        : {}),
      ...(this.options.maxElapsedMsPerTask !== undefined
        ? { maxElapsedMs: this.options.maxElapsedMsPerTask }
        : {}),
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
      if (!(error instanceof HarnessError && error.code === "INVALID_STATE")) throw error;
    }
  }

  private report(): MorningReport {
    const loaded = this.load();
    const o = this.options;
    const built = buildMorningReport(this.port.read(), loaded.events, this.clock.now(), {
      maxParallel: o.maxParallel,
      ...(o.gateMaxParallel !== undefined ? { gateMaxParallel: o.gateMaxParallel } : {}),
    });
    return { ...built, deadAgentsReclaimed: this.sessionReclaimedCount };
  }

  public async run(): Promise<SupervisionRunResult> {
    const companionPairing = OrchestratorCompanionAuditor.pairCompanion(this.repoRoot, {
      strictPolicy: this.options.strictAuditorPolicy,
    });

    const startedAt = this.clock.now().valueOf();
    const maxTotalElapsedMs = this.options.maxTotalElapsedMs ?? DEFAULT_MAX_TOTAL_ELAPSED_MS;
    const pollIntervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    let ticks = 0;
    let last = await this.tick();
    ticks += 1;

    const buildResult = (stopReason: SupervisorStopReason): SupervisionRunResult => ({
      stopReason,
      ticks,
      lastTick: last,
      report: this.report(),
      companionPairing,
      behavioralForensicsSummary: OrchestratorCompanionAuditor.executeForensics(this.repoRoot, {
        capsuleRunRoot: this.options.runRoot,
        now: this.clock.now().toISOString(),
      }),
    });

    if (this.options.dispatcher === undefined) {
      return buildResult("single_tick");
    }

    for (;;) {
      const state = this.port.read();
      if (isRunTerminal(state)) return buildResult("terminal");
      if (this.clock.now().valueOf() - startedAt >= maxTotalElapsedMs)
        return buildResult("elapsed_budget_exhausted");
      if (last.dispatchable.length === 0 && last.occupied === 0 && last.backingOff.length === 0)
        return buildResult("stalled");

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
