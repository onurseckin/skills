import { HarnessError } from "../../core/errors/index.ts";
import {
  heartbeatWatchdog,
  registerWatchdog,
  type WatchdogRecord,
} from "../../authority/watchdog-manager.ts";
import {
  systemClock,
  type Clock,
  type TransactionPort,
  type WorkflowState,
} from "../../workflow/types.ts";
import {
  auditGraphHealth,
  recoverStaleTasks,
  SchedulerEngine,
  type GraphHealthAuditReport,
  type ScheduledTaskDispatch,
  type Supervisory5PointHealthReport,
  type SupervisoryProbeDispatchResult,
  type TaskRecoveryResult,
} from "./core-engine.ts";
import {
  generateAsciiDagBadges,
  runScriptBackedDiagnostics,
  type CliDiagnosticReceipt,
  type ScriptBackedDiagnosticsOptions,
  type ScriptBackedDiagnosticsResult,
} from "./diagnostics.ts";

export interface PulseTickOptions {
  readonly tickNumber?: number | undefined;
  readonly maxParallel?: number | null | undefined;
  readonly timeoutMs?: number | undefined;
  readonly heartbeatCadenceMs?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly watchdogTarget?: string | undefined;
  readonly watchdogId?: string | undefined;
  readonly maxRepairRounds?: number | undefined;
  readonly autoRecoverStale?: boolean | undefined;
  readonly runRoot?: string | undefined;
  readonly dispatchLeaderProbe?: boolean | undefined;
  readonly assertDoctorGate?: boolean | undefined;
  readonly runDiagnostics?: boolean | undefined;
  readonly diagnosticsResult?: ScriptBackedDiagnosticsResult | undefined;
  readonly diagnosticsOptions?: ScriptBackedDiagnosticsOptions | undefined;
}

export interface PulseTickResult {
  readonly tickNumber: number;
  readonly timestamp: string;
  readonly graphHealthy: boolean;
  readonly auditReport: GraphHealthAuditReport;
  readonly supervisoryReport?: Supervisory5PointHealthReport | undefined;
  readonly probeDispatch?: SupervisoryProbeDispatchResult | undefined;
  readonly recoveryResult?: TaskRecoveryResult | undefined;
  readonly readyTasks: readonly ScheduledTaskDispatch[];
  readonly activeOccupiedTasks: readonly string[];
  readonly workflowCompleted: boolean;
  readonly diagnostics?: ScriptBackedDiagnosticsResult | undefined;
  readonly cliReceipts?: readonly CliDiagnosticReceipt[] | undefined;
  readonly cliReceiptSummaryBadge?: string | undefined;
  readonly dagBadges?: readonly string[] | undefined;
  readonly error?: string | undefined;
}

export interface PulseLoopOptions extends PulseTickOptions {
  readonly intervalMs?: number | undefined;
  readonly maxTicks?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly stopWhenDone?: boolean | undefined;
  readonly onTick?: ((result: PulseTickResult) => void) | undefined;
  readonly onError?: ((error: Error, tickNumber: number) => void) | undefined;
  readonly onStop?: ((reason: string, totalTicks: number) => void) | undefined;
}

export interface PulseLoopResult {
  readonly totalTicks: number;
  readonly totalRecovered: number;
  readonly totalDispatched: number;
  readonly stoppedReason: "max_ticks_reached" | "workflow_completed" | "aborted" | "error";
  readonly durationMs: number;
  readonly lastTickResult?: PulseTickResult | undefined;
  readonly lastDiagnostics?: ScriptBackedDiagnosticsResult | undefined;
  readonly errors: readonly string[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a single atomic pulse tick:
 * 1. Audits graph health across all 5 probes.
 * 2. Runs 5-point supervisory health audit and dispatches active probe to top leader.
 * 3. Heartbeats supervisory watchdog.
 * 4. Recovers stale leases if autoRecoverStale is enabled.
 * 5. Evaluates batch readiness and workflow convergence.
 * 6. Embeds script-backed CLI receipts and ASCII DAG badges.
 */
export function executePulseTick(
  port: TransactionPort,
  options: PulseTickOptions = {},
): PulseTickResult {
  const tickNumber = options.tickNumber ?? 1;
  const clock = options.clock ?? systemClock;
  const now = clock.now();
  const timestamp = now.toISOString();
  const engine = new SchedulerEngine({
    maxParallel: options.maxParallel,
    timeoutMs: options.timeoutMs,
    heartbeatCadenceMs: options.heartbeatCadenceMs,
    clock,
    watchdogTarget: options.watchdogTarget,
    maxRepairRounds: options.maxRepairRounds,
  });

  try {
    const currentState = port.read();

    // 1. Audit Graph Health (5 Probes)
    const auditReport = engine.auditHealth(currentState);

    // 2. Supervisory 5-Point Health & Leader Probe (p24)
    const supervisoryReport = engine.auditSupervisory5Point(currentState, {
      runRoot: options.runRoot,
    });

    let probeDispatch: SupervisoryProbeDispatchResult | undefined = undefined;
    if (options.dispatchLeaderProbe !== false) {
      probeDispatch = engine.dispatchTopLeaderProbe(currentState, {
        runRoot: options.runRoot,
      });
    }

    // 3. Supervisory Watchdog Heartbeat
    if (options.watchdogId !== undefined) {
      try {
        heartbeatWatchdog(options.watchdogId, { now }, options.watchdogTarget);
      } catch {
        // Fallback: register fresh if existing expired/missing
        registerWatchdog(
          {
            id: options.watchdogId,
            phase: "scheduler-pulse",
            agent_id: "scheduler-engine",
            now,
          },
          options.watchdogTarget,
        );
      }
    }

    // 4. Stale lease automatic recovery
    let recoveryResult: TaskRecoveryResult | undefined = undefined;
    if (options.autoRecoverStale !== false) {
      recoveryResult = engine.recoverStale(port);
    }

    // 5. Re-read state post-recovery and evaluate wave
    const statePostRecovery = port.read();
    const waveResult = engine.evaluateWave(statePostRecovery, options.maxParallel);

    // 6. Check if all tasks reached terminal or validated status
    const tasks = Object.values(statePostRecovery.tasks ?? {});
    const workflowCompleted =
      tasks.length > 0 &&
      tasks.every(
        (t) => t.status === "done" || t.status === "validated" || t.status === "cancelled",
      );

    // 7. Script-Backed Diagnostics & ASCII DAG Badges
    const dagBadges = generateAsciiDagBadges(statePostRecovery);
    const diag = options.diagnosticsResult;

    return {
      tickNumber,
      timestamp,
      graphHealthy:
        auditReport.healthy && supervisoryReport.healthy && (diag ? diag.healthy : true),
      auditReport,
      supervisoryReport,
      probeDispatch,
      recoveryResult,
      readyTasks: waveResult.readyTasks,
      activeOccupiedTasks: waveResult.activeOccupiedTasks,
      workflowCompleted,
      diagnostics: diag,
      cliReceipts: diag?.receipts,
      cliReceiptSummaryBadge: diag?.receiptSummaryBadge,
      dagBadges: diag?.dagBadges && diag.dagBadges.length > 0 ? diag.dagBadges : dagBadges,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const fallbackAudit = auditGraphHealth(port.read(), { now });

    return {
      tickNumber,
      timestamp,
      graphHealthy: false,
      auditReport: fallbackAudit,
      readyTasks: [],
      activeOccupiedTasks: [],
      workflowCompleted: false,
      error: errorMsg,
    };
  }
}

/**
 * Asynchronous pulse tick execution with automatic script-backed CLI diagnostics.
 * Executes real Harness CLI diagnostics (doctor, health, dag:view, report:unified)
 * prior to evaluating graph state and dispatches.
 */
export async function executePulseTickWithDiagnostics(
  port: TransactionPort,
  options: PulseTickOptions = {},
): Promise<PulseTickResult> {
  const clock = options.clock ?? systemClock;
  const state = port.read();

  const diagResult = await runScriptBackedDiagnostics({
    runRoot: options.runRoot,
    state,
    clock,
    ...options.diagnosticsOptions,
  });

  return executePulseTick(port, {
    ...options,
    diagnosticsResult: diagResult,
  });
}

/**
 * Continuous / Multi-tick Scheduler Pulse Loop
 * Resilient floor loop execution with error isolation and script-backed diagnostics support.
 */
export async function runPulseLoop(
  port: TransactionPort,
  options: PulseLoopOptions = {},
): Promise<PulseLoopResult> {
  const startTime = Date.now();
  const intervalMs = options.intervalMs ?? 500;
  const maxTicks = options.maxTicks ?? Number.POSITIVE_INFINITY;
  const stopWhenDone = options.stopWhenDone !== false;
  const signal = options.signal;
  const runDiagnostics = options.runDiagnostics ?? Boolean(options.runRoot);

  let tickCount = 0;
  let totalRecovered = 0;
  let totalDispatched = 0;
  let lastTickResult: PulseTickResult | undefined = undefined;
  let lastDiagnostics: ScriptBackedDiagnosticsResult | undefined = undefined;
  const errors: string[] = [];
  let stoppedReason: "max_ticks_reached" | "workflow_completed" | "aborted" | "error" =
    "max_ticks_reached";

  // Register watchdog for the loop session
  let watchdog: WatchdogRecord | undefined = undefined;
  try {
    watchdog = registerWatchdog(
      {
        phase: "scheduler-continuous-loop",
        agent_id: "scheduler-pulse-loop",
        now: options.clock?.now() ?? new Date(),
        heartbeat_cadence_ms: options.heartbeatCadenceMs ?? 180_000,
        timeout_ms: options.timeoutMs ?? 360_000,
      },
      options.watchdogTarget,
    ).watchdog;
  } catch {
    // Non-fatal
  }

  while (tickCount < maxTicks) {
    if (signal?.aborted) {
      stoppedReason = "aborted";
      break;
    }

    tickCount++;

    try {
      let diagResult: ScriptBackedDiagnosticsResult | undefined = options.diagnosticsResult;
      if (runDiagnostics && !diagResult) {
        try {
          diagResult = await runScriptBackedDiagnostics({
            runRoot: options.runRoot,
            state: port.read(),
            clock: options.clock,
            ...options.diagnosticsOptions,
          });
          lastDiagnostics = diagResult;
        } catch (diagErr: unknown) {
          const diagErrMsg = diagErr instanceof Error ? diagErr.message : String(diagErr);
          errors.push(`Tick ${tickCount} diagnostics error: ${diagErrMsg}`);
        }
      }

      const tickResult = executePulseTick(port, {
        ...options,
        tickNumber: tickCount,
        watchdogId: watchdog?.id,
        diagnosticsResult: diagResult,
      });

      lastTickResult = tickResult;
      if (tickResult.recoveryResult) {
        totalRecovered += tickResult.recoveryResult.recoveredCount;
      }
      totalDispatched += tickResult.readyTasks.length;

      if (options.onTick) {
        options.onTick(tickResult);
      }

      if (tickResult.error) {
        errors.push(`Tick ${tickCount} error: ${tickResult.error}`);
        if (options.onError) {
          options.onError(new Error(tickResult.error), tickCount);
        }
      }

      if (stopWhenDone && tickResult.workflowCompleted) {
        stoppedReason = "workflow_completed";
        break;
      }
    } catch (loopErr: unknown) {
      // Floor resilience: isolate error to preserve continuous execution
      const errInstance = loopErr instanceof Error ? loopErr : new Error(String(loopErr));
      errors.push(`Tick ${tickCount} unexpected loop error: ${errInstance.message}`);
      if (options.onError) {
        options.onError(errInstance, tickCount);
      }
    }

    if (tickCount >= maxTicks) {
      stoppedReason = "max_ticks_reached";
      break;
    }

    if (signal?.aborted) {
      stoppedReason = "aborted";
      break;
    }

    if (intervalMs > 0) {
      await delay(intervalMs);
    }
  }

  if (options.onStop) {
    options.onStop(stoppedReason, tickCount);
  }

  return {
    totalTicks: tickCount,
    totalRecovered,
    totalDispatched,
    stoppedReason,
    durationMs: Date.now() - startTime,
    lastTickResult,
    lastDiagnostics,
    errors,
  };
}
