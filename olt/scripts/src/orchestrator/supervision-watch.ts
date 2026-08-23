import { workflowPort } from "../integration/store-ports.ts";
import { loadRun } from "../engine/store/index.ts";
import { systemClock, type Clock } from "../workflow/types.ts";
import { buildMorningReport, type MorningReport } from "./morning-report.ts";
import type { DispatchLogEvent } from "./dispatch-log.ts";
import { isRunTerminal } from "./run-terminal.ts";
import {
  runSupervisionTick,
  type SupervisionTickConfig,
  type SupervisionTickResult,
} from "./supervision-tick.ts";

export type WatchStopReason = "terminal" | "stopped";

export interface RunSupervisionWatchOptions {
  readonly runRoot: string;
  readonly actor: string;
  readonly intervalMs: number;
  readonly recoveryEnabled?: boolean;
  readonly graceSeconds?: number;
  readonly deterministicRepeatThreshold?: number;
  readonly maxElapsedMsPerTask?: number;
  readonly maxParallel?: number;
  readonly gateMaxParallel?: number;
  readonly clock?: Clock;
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onTick?: (tick: SupervisionTickResult, tickNumber: number) => void;
}

export interface RunSupervisionWatchResult {
  readonly stopReason: WatchStopReason;
  readonly ticks: number;
  readonly lastTick: SupervisionTickResult;
  readonly report: MorningReport;
}

function defaultSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runSupervisionWatch(
  options: RunSupervisionWatchOptions,
): Promise<RunSupervisionWatchResult> {
  const port = workflowPort(options.runRoot);
  const clock = options.clock ?? systemClock;
  const signal = options.signal;
  const sleepFn = options.sleep ?? ((ms: number) => defaultSleep(ms, signal));

  const tickConfig: SupervisionTickConfig = {
    clock,
    ...(options.recoveryEnabled === undefined ? {} : { recoveryEnabled: options.recoveryEnabled }),
    ...(options.graceSeconds === undefined ? {} : { graceSeconds: options.graceSeconds }),
    ...(options.deterministicRepeatThreshold === undefined
      ? {}
      : { deterministicRepeatThreshold: options.deterministicRepeatThreshold }),
    ...(options.maxElapsedMsPerTask === undefined
      ? {}
      : { maxElapsedMs: options.maxElapsedMsPerTask }),
  };

  function report(): MorningReport {
    const loaded = loadRun(options.runRoot);
    const events = (loaded?.events ?? []) as readonly DispatchLogEvent[];
    return buildMorningReport(port.read(), events, clock.now(), {
      ...(options.maxParallel === undefined ? {} : { maxParallel: options.maxParallel }),
      ...(options.gateMaxParallel === undefined
        ? {}
        : { gateMaxParallel: options.gateMaxParallel }),
    });
  }

  function runTick(tickNumber: number): SupervisionTickResult {
    const tick = runSupervisionTick(port, options.actor, tickConfig);
    options.onTick?.(tick, tickNumber);
    return tick;
  }

  function stopRequested(): boolean {
    return signal !== undefined && signal.aborted;
  }

  let ticks = 1;
  let last = runTick(ticks);

  for (;;) {
    if (isRunTerminal(last.state)) {
      return { stopReason: "terminal", ticks, lastTick: last, report: report() };
    }
    if (stopRequested()) {
      return { stopReason: "stopped", ticks, lastTick: last, report: report() };
    }
    await sleepFn(options.intervalMs);
    if (stopRequested()) {
      return { stopReason: "stopped", ticks, lastTick: last, report: report() };
    }
    ticks += 1;
    last = runTick(ticks);
  }
}
