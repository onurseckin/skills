import { open, mkdir, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { ActivityRecord } from "../../reconciliation/activity-record.ts";
import { settleBounded, settleTrackerBeforeOutcome } from "./attempt-support.ts";
import { finalizeSuccessfulAttempt } from "./attempt-success-evidence.ts";
import {
  startAttemptIntent,
  type AttemptIntentController,
} from "../../execution/attempt-intent.ts";
import { FailureEvidence } from "../../receipt/failure-evidence.ts";
import {
  DescendantTracker,
  type ProcessIdentity,
} from "../../reconciliation/descendant-tracker.ts";
import { addedPipeHandles, OWNERSHIP_ENV, runnerPipeHandles } from "../../core/pipe-ownership.ts";
import type { CommandSigningCapability } from "../../execution/attempt-disposition-capability.ts";
import type {
  AttemptResult,
  BunSpawnApi,
  NormalizedCommandOptions,
  OutputSummary,
} from "../../types/types.ts";
import {
  cleanupAfterAttemptFailure,
  handleAttemptFailure,
  settleAndTerminateAttempt,
  startAttemptPumpsAndMonitoring,
} from "../../execution/attempt-failure-cleanup.ts";

export { cleanupAfterAttemptFailure };

export async function runAttempt(
  options: NormalizedCommandOptions,
  attempt: number,
  commandId: string,
  commandRoot: string,
  attemptSigner: CommandSigningCapability,
  spawnApi: BunSpawnApi = Bun as unknown as BunSpawnApi,
): Promise<AttemptResult> {
  const attemptDir = join(commandRoot, `attempt-${attempt}`);
  await mkdir(attemptDir, { recursive: false, mode: 0o700 });
  const stdoutPath = join(attemptDir, "stdout.log");
  const stderrPath = join(attemptDir, "stderr.log");
  const activityPath = join(attemptDir, "activity.json");
  let stdout: FileHandle | undefined, stderr: FileHandle | undefined;
  let child: ReturnType<BunSpawnApi["spawn"]> | undefined,
    descendants: DescendantTracker | undefined;
  let activityRecord: ActivityRecord | undefined, rootIdentity: ProcessIdentity | undefined;
  let attemptIntent: AttemptIntentController | undefined;
  let trackerReady: Promise<ProcessIdentity | undefined> | undefined, startedAt: Date | undefined;
  let observedExitCode: number | null = null,
    outputTail = "";
  const deliveredSignals: NodeJS.Signals[] = [],
    durableSignals: NodeJS.Signals[] = [],
    processGroupSignals: NodeJS.Signals[] = [];
  let cleanupPrewriteFailed = false;
  const pumps: Promise<OutputSummary>[] = [],
    pumpAbort = new AbortController();
  const persistSignal = (signal: NodeJS.Signals): void => {
    if (durableSignals.includes(signal)) return;
    attemptIntent?.recordSignal(signal);
    durableSignals.push(signal);
  };
  const recordSignal = (signal: NodeJS.Signals): void => {
    if (!deliveredSignals.includes(signal)) deliveredSignals.push(signal);
    persistSignal(signal);
  };
  try {
    stdout = await open(stdoutPath, "wx", 0o600);
    stderr = await open(stderrPath, "wx", 0o600);
    startedAt = new Date();
    activityRecord = new ActivityRecord(
      attemptDir,
      commandId,
      attempt,
      startedAt.toISOString(),
      options.heartbeatIntervalMs,
    );
    let lastActivity = startedAt.valueOf();
    const evidence = new FailureEvidence();
    const activity = (channel: "stderr" | "stdout") => (text: string, bytes: number) => {
      lastActivity = Date.now();
      outputTail = `${outputTail}${text}`.slice(-8_192);
      evidence.ingest(text);
      activityRecord!.output(channel, bytes);
    };
    const runtime = spawnApi;
    const pipeBaseline = runnerPipeHandles();
    const ownershipToken = options.environment[OWNERSHIP_ENV];
    if (!ownershipToken) throw new Error("command ownership token is missing");
    attemptIntent = startAttemptIntent(
      attemptDir,
      commandId,
      attempt,
      startedAt.toISOString(),
      ownershipToken,
      (identity) => {
        rootIdentity = identity;
      },
      attemptSigner,
    );
    child = runtime.spawn({
      cmd: options.argv,
      cwd: options.cwd,
      detached: true,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: options.environment,
    });
    void child.exited.then(
      (code) => {
        observedExitCode = code;
      },
      () => undefined,
    );
    descendants = new DescendantTracker(child.pid, addedPipeHandles(pipeBaseline), ownershipToken);
    trackerReady = descendants.start().then(attemptIntent.bindRoot);
    const { allPumps, monitoring } = startAttemptPumpsAndMonitoring(
      options,
      child,
      stdout!,
      stderr!,
      stdoutPath,
      stderrPath,
      activity,
      pumps,
      pumpAbort,
      startedAt,
      () => lastActivity,
      activityRecord,
    );
    const pumpFailed = allPumps.then(
      () => new Promise<never>(() => undefined),
      (error) => Promise.reject(error),
    );
    const outcome = await settleTrackerBeforeOutcome(
      Promise.race([monitoring, pumpFailed]),
      trackerReady,
    );
    await descendants.stop();
    try {
      attemptIntent.beginCleanupUncertain(["attempt process settlement is in progress"]);
    } catch (error) {
      cleanupPrewriteFailed = true;
      throw error;
    }
    const { rootProof, exitCode } = await settleAndTerminateAttempt(
      child,
      descendants,
      rootIdentity,
      options,
      outcome,
      processGroupSignals,
      recordSignal,
    );
    const uniqueSignals = [...deliveredSignals];
    return await finalizeSuccessfulAttempt({
      allPumps,
      options,
      commandId,
      attempt,
      attemptDir,
      stdoutPath,
      stderrPath,
      activityPath,
      startedAt,
      outcome,
      exitCode,
      child,
      uniqueSignals,
      evidence,
      outputTail,
      activityRecord,
      rootProof,
      rootIdentity,
      attemptIntent,
    });
  } catch (error) {
    await handleAttemptFailure({
      error,
      terminalProofDurable: false,
      cleanupPrewriteFailed,
      attemptIntent,
      child,
      descendants,
      rootIdentity,
      trackerReady,
      activityRecord,
      pumps,
      pumpAbort,
      options,
      deliveredSignals,
      durableSignals,
      processGroupSignals,
      persistSignal,
      startedAt,
      commandId,
      attempt,
      attemptDir,
      observedExitCode,
      outputTail,
    });
    throw error;
  } finally {
    pumpAbort.abort();
    try {
      await descendants?.stop();
    } catch {}
    await settleBounded(pumps, options.drainTimeoutMs);
    await Promise.allSettled([stdout?.close(), stderr?.close()].filter(Boolean));
  }
}
