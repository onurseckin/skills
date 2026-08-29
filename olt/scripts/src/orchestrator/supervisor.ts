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
  // Live per-tick diffs (reclaim.reclaimed) are already correctly scoped to this call and this
  // actor; buildMorningReport's deadAgentsReclaimed is not — it filters the run's ENTIRE persisted
  // event log by kind alone, so a reclaim a different orchestrator actor recorded hours earlier on
  // this same run keeps counting on every later report. Summing the live per-tick diffs ourselves,
  // bounded to this RunSupervisor instance's own lifetime, sidesteps that unscoped re-derivation
  // entirely instead of trying to make the historical scan itself actor/time aware.
  private sessionReclaimedCount = 0;

  public constructor(private readonly options: RunSupervisorOptions) {
    this.port = workflowPort(options.runRoot);
    this.clock = options.clock !== undefined ? options.clock : systemClock;
    this.sleepFn =
      options.sleep !== undefined
        ? options.sleep
        : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    this.repoRoot = findRepoRoot(options.runRoot);
  }

  private load(): ReturnType<typeof loadRun> {
    return loadRun(this.options.runRoot);
  }

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
    this.sessionReclaimedCount += reclaim.reclaimed.length;

    const loaded = this.load();
    const freeSlots = Math.max(0, o.maxParallel - reclaim.occupied);
    const selection = selectDispatchable(loaded.state, loaded.events, freeSlots, this.clock.now());

    // Execute out-of-band behavioral forensics per tick
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
      ...(o.gateMaxParallel === undefined ? {} : { gateMaxParallel: o.gateMaxParallel }),
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
    const signal =
      failure !== undefined && failure.signal !== undefined ? failure.signal : "unknown";
    const detail =
      failure !== undefined && failure.detail !== undefined ? failure.detail : "unknown";
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
      let isIgnorable = false;
      if (error instanceof HarnessError) {
        if (error.code === "INVALID_STATE") isIgnorable = true;
      }
      if (!isIgnorable) throw error;
    }
  }

  private report(): MorningReport {
    const loaded = this.load();
    const o = this.options;
    const built = buildMorningReport(this.port.read(), loaded.events, this.clock.now(), {
      maxParallel: o.maxParallel,
      ...(o.gateMaxParallel === undefined ? {} : { gateMaxParallel: o.gateMaxParallel }),
    });
    return { ...built, deadAgentsReclaimed: this.sessionReclaimedCount };
  }

  public async run(): Promise<SupervisionRunResult> {
    // 1. Auto-pair companion Skill Auditor
    const companionPairing = OrchestratorCompanionAuditor.pairCompanion(this.repoRoot, {
      strictPolicy: this.options.strictAuditorPolicy,
    });

    const startedAt = this.clock.now().valueOf();
    const maxTotalElapsedMs =
      this.options.maxTotalElapsedMs !== undefined
        ? this.options.maxTotalElapsedMs
        : DEFAULT_MAX_TOTAL_ELAPSED_MS;
    const pollIntervalMs =
      this.options.pollIntervalMs !== undefined
        ? this.options.pollIntervalMs
        : DEFAULT_POLL_INTERVAL_MS;

    let ticks = 0;
    let last = await this.tick();
    ticks += 1;

    if (this.options.dispatcher === undefined) {
      const summaryReport = OrchestratorCompanionAuditor.executeForensics(this.repoRoot, {
        capsuleRunRoot: this.options.runRoot,
        now: this.clock.now().toISOString(),
      });
      return {
        stopReason: "single_tick",
        ticks,
        lastTick: last,
        report: this.report(),
        companionPairing,
        behavioralForensicsSummary: summaryReport,
      };
    }

    for (;;) {
      const state = this.port.read();
      if (isRunTerminal(state)) {
        const summaryReport = OrchestratorCompanionAuditor.executeForensics(this.repoRoot, {
          capsuleRunRoot: this.options.runRoot,
          now: this.clock.now().toISOString(),
        });
        return {
          stopReason: "terminal",
          ticks,
          lastTick: last,
          report: this.report(),
          companionPairing,
          behavioralForensicsSummary: summaryReport,
        };
      }
      if (this.clock.now().valueOf() - startedAt >= maxTotalElapsedMs) {
        const summaryReport = OrchestratorCompanionAuditor.executeForensics(this.repoRoot, {
          capsuleRunRoot: this.options.runRoot,
          now: this.clock.now().toISOString(),
        });
        return {
          stopReason: "elapsed_budget_exhausted",
          ticks,
          lastTick: last,
          report: this.report(),
          companionPairing,
          behavioralForensicsSummary: summaryReport,
        };
      }
      const stuck =
        last.dispatchable.length === 0 && last.occupied === 0 && last.backingOff.length === 0;
      if (stuck) {
        const summaryReport = OrchestratorCompanionAuditor.executeForensics(this.repoRoot, {
          capsuleRunRoot: this.options.runRoot,
          now: this.clock.now().toISOString(),
        });
        return {
          stopReason: "stalled",
          ticks,
          lastTick: last,
          report: this.report(),
          companionPairing,
          behavioralForensicsSummary: summaryReport,
        };
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
