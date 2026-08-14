import type { FileHandle } from "node:fs/promises";
import { cleanupFailedAttempt } from "./attempt-cleanup.ts";
import { createAttemptExecutionError } from "./attempt-failure-evidence.ts";
import { probeAttemptProcess } from "./attempt-intent.ts";
import { OutputBudget } from "./output-budget.ts";
import { pumpOutput } from "./output-pump.ts";
import { portableArtifactPath } from "./artifact-paths.ts";
import { terminateProcessGroup } from "./process-group.ts";
import { monitorProcess, type WatchdogOutcome } from "./watchdog.ts";
import type { AttemptIntentController } from "./attempt-intent.ts";
import type { ActivityRecord } from "./activity-record.ts";
import type { DescendantTracker, ProcessIdentity } from "./descendant-tracker.ts";
import type { BunSpawnApi, NormalizedCommandOptions, OutputSummary } from "./types.ts";

export async function cleanupAfterAttemptFailure<T>(
  error: unknown,
  terminalProofDurable: boolean,
  cleanup: () => Promise<T>,
): Promise<T> {
  if (terminalProofDurable) throw error;
  return cleanup();
}

export function startAttemptPumpsAndMonitoring(
  options: NormalizedCommandOptions,
  child: ReturnType<BunSpawnApi["spawn"]>,
  stdout: FileHandle,
  stderr: FileHandle,
  stdoutPath: string,
  stderrPath: string,
  activity: (channel: "stderr" | "stdout") => (text: string, bytes: number) => void,
  pumps: Promise<OutputSummary>[],
  pumpAbort: AbortController,
  startedAt: Date,
  lastActivity: () => number,
  activityRecord: ActivityRecord,
): { allPumps: Promise<[OutputSummary, OutputSummary]>; monitoring: Promise<WatchdogOutcome> } {
  const budget = new OutputBudget(options.maxOutputBytes);
  const pump = options.pump ?? pumpOutput;
  pumps.push(
    pump(child.stdout, stdout, portableArtifactPath(options.runRoot, stdoutPath), activity("stdout"), {
      signal: pumpAbort.signal,
      budget,
    }),
    pump(child.stderr, stderr, portableArtifactPath(options.runRoot, stderrPath), activity("stderr"), {
      signal: pumpAbort.signal,
      budget,
    }),
  );
  const allPumps = Promise.all(pumps) as Promise<[OutputSummary, OutputSummary]>;
  const monitoring = monitorProcess(
    child,
    startedAt.valueOf(),
    lastActivity,
    options.wallTimeoutMs,
    options.idleTimeoutMs,
    () => activityRecord.heartbeat(),
    options.signal,
  );
  return { allPumps, monitoring };
}

export async function settleAndTerminateAttempt(
  child: ReturnType<BunSpawnApi["spawn"]>,
  descendants: DescendantTracker,
  rootIdentity: ProcessIdentity | undefined,
  options: NormalizedCommandOptions,
  outcome: WatchdogOutcome,
  processGroupSignals: NodeJS.Signals[],
  recordSignal: (signal: NodeJS.Signals) => void,
): Promise<{ descendantsAbsent: boolean; rootProof: boolean; exitCode: number | null }> {
  if ((outcome.timeout || outcome.interrupted) && !rootIdentity)
    throw new Error(
      `termination withheld because strong root identity was unavailable; residual pid ${child.pid} requires inspection`,
    );
  if (outcome.timeout || outcome.interrupted)
    await terminateProcessGroup(child.pid, options.graceMs, child.exited, rootIdentity, {
      onSignal: (signal) => {
        if (!processGroupSignals.includes(signal)) processGroupSignals.push(signal);
        recordSignal(signal);
      },
    });
  await descendants.terminate(options.graceMs, recordSignal);
  const exitCode = outcome.code ?? (await child.exited.catch(() => null));
  const descendantsAbsent = await descendants.proveAbsent();
  let rootProof = false;
  if (rootIdentity) {
    try {
      rootProof = probeAttemptProcess(rootIdentity) === "absent";
    } catch {}
  }
  if (!descendantsAbsent || ((outcome.timeout || outcome.interrupted) && !rootProof))
    throw new Error("attempt process absence was not proven before terminal evidence");
  return { descendantsAbsent, rootProof, exitCode };
}

export async function handleAttemptFailure(ctx: {
  error: unknown;
  terminalProofDurable: boolean;
  cleanupPrewriteFailed: boolean;
  attemptIntent: AttemptIntentController | undefined;
  child: ReturnType<BunSpawnApi["spawn"]> | undefined;
  descendants: DescendantTracker | undefined;
  rootIdentity: ProcessIdentity | undefined;
  trackerReady: Promise<ProcessIdentity | undefined> | undefined;
  activityRecord: ActivityRecord | undefined;
  pumps: Promise<OutputSummary>[];
  pumpAbort: AbortController;
  options: NormalizedCommandOptions;
  deliveredSignals: NodeJS.Signals[];
  durableSignals: NodeJS.Signals[];
  processGroupSignals: NodeJS.Signals[];
  persistSignal: (signal: NodeJS.Signals) => void;
  startedAt: Date | undefined;
  commandId: string;
  attempt: number;
  attemptDir: string;
  observedExitCode: number | null;
  outputTail: string;
}): Promise<never> {
  const cleanup = await cleanupAfterAttemptFailure(ctx.error, ctx.terminalProofDurable, () =>
    cleanupFailedAttempt({
      child: ctx.child,
      descendants: ctx.descendants,
      rootIdentity: ctx.rootIdentity,
      trackerReady: ctx.trackerReady,
      activityRecord: ctx.activityRecord,
      pumps: ctx.pumps,
      pumpAbort: ctx.pumpAbort,
      graceMs: ctx.options.graceMs,
      drainTimeoutMs: ctx.options.drainTimeoutMs,
      signalsSent: ctx.deliveredSignals,
      signalsRecorded: ctx.durableSignals,
      processGroupSignalsSent: ctx.processGroupSignals,
      beforeCleanup: () => {
        if (ctx.cleanupPrewriteFailed) throw ctx.error;
        try {
          ctx.attemptIntent?.beginCleanupUncertain([
            ctx.error instanceof Error ? ctx.error.message : String(ctx.error),
          ]);
        } catch (dispositionError) {
          throw new Error(
            `${ctx.error instanceof Error ? ctx.error.message : String(ctx.error)}; cleanup uncertainty prewrite failed: ${String(dispositionError)}`,
          );
        }
      },
      persistSignal: ctx.persistSignal,
    }),
  );
  if (cleanup.issues.length > 0) {
    try {
      ctx.attemptIntent?.beginCleanupUncertain(cleanup.issues);
    } catch (dispositionError) {
      cleanup.issues.push(`cleanup uncertainty disposition failed: ${String(dispositionError)}`);
    }
    throw new Error(
      `${ctx.error instanceof Error ? ctx.error.message : String(ctx.error)}; command cleanup failed: ${cleanup.issues.join("; ")}`,
    );
  }
  if (ctx.startedAt && ctx.activityRecord) {
    try {
      if (!cleanup.terminalProof)
        throw new Error("failed attempt cleanup lacks strong terminal process proof");
      ctx.attemptIntent?.markRecordPending("failed-attempt evidence is ready to persist");
      ctx.attemptIntent?.markTerminalProof(
        "failed-attempt root and descendant absence proven",
        cleanup.terminalProof,
      );
    } catch (proofError) {
      throw new Error(
        `${ctx.error instanceof Error ? ctx.error.message : String(ctx.error)}; terminal process proof failed: ${String(proofError)}`,
      );
    }
    throw createAttemptExecutionError({
      options: ctx.options,
      commandId: ctx.commandId,
      attempt: ctx.attempt,
      attemptDir: ctx.attemptDir,
      startedAt: ctx.startedAt,
      exitCode: ctx.observedExitCode,
      signal: ctx.child?.signalCode ?? null,
      signals: cleanup.signals,
      outputTail: ctx.outputTail,
      error: ctx.error,
    });
  }
  throw ctx.error;
}
