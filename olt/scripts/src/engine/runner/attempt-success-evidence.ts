import { join } from "node:path";
import type { CommandAttemptRecord } from "../../core/contracts/index.ts";
import { atomicWriteJson } from "../../core/durable-write.ts";
import { readBoundedBytes } from "../../core/json.ts";
import { activityMetadata, raceWithTimeout } from "./attempt-support.ts";
import { portableArtifactPath } from "./artifact-paths.ts";
import { classifySignals, type FailureSignals } from "./classify-failure.ts";
import { outputEvidenceIssues } from "./output-evidence.ts";
import type {
  AttemptResult,
  BunSpawnApi,
  NormalizedCommandOptions,
  OutputSummary,
} from "./types.ts";
import type { WatchdogOutcome } from "./watchdog.ts";
import type { ActivityRecord } from "./activity-record.ts";
import type { ProcessIdentity } from "./descendant-tracker.ts";
import {
  settledAttemptTerminalProof,
  strongAttemptTerminalProof,
  type AttemptIntentController,
} from "./attempt-intent.ts";

interface SuccessfulAttemptEvidence {
  options: NormalizedCommandOptions;
  commandId: string;
  attempt: number;
  attemptDir: string;
  stdoutPath: string;
  stderrPath: string;
  activityPath: string;
  startedAt: Date;
  finishedAt: Date;
  outcome: WatchdogOutcome;
  exitCode: number | null;
  signal: string | null;
  signals: string[];
  stdoutLog: OutputSummary;
  stderrLog: OutputSummary;
  failureSignals: FailureSignals;
  outputTail: string;
}

export function writeSuccessfulAttemptEvidence(input: SuccessfulAttemptEvidence): AttemptResult {
  const evidenceIssues = outputEvidenceIssues(
    input.options.argv,
    readBoundedBytes(input.stdoutPath, input.options.maxOutputBytes),
    readBoundedBytes(input.stderrPath, input.options.maxOutputBytes),
  );
  const failureClass = input.outcome.timeout
    ? "timeout"
    : evidenceIssues.length > 0
      ? "test_failure"
      : classifySignals(
          input.exitCode,
          input.failureSignals,
          input.outcome.timeout,
          input.outcome.interrupted,
        );
  const activityPath = portableArtifactPath(input.options.runRoot, input.activityPath);
  const record: CommandAttemptRecord = {
    id: input.commandId,
    attempt: input.attempt,
    status: input.outcome.timeout
      ? "timed_out"
      : input.outcome.interrupted || input.exitCode !== 0 || evidenceIssues.length > 0
        ? "failed"
        : "succeeded",
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    exit_code: input.exitCode,
    signal: input.signal,
    signals_sent: input.signals,
    timeout_kind: input.outcome.timeout,
    failure_class: failureClass ?? null,
    activity_path: activityPath,
    activity: activityMetadata(input.activityPath, activityPath),
    logs: { stdout: input.stdoutLog, stderr: input.stderrLog },
    evidence_issues: evidenceIssues,
  };
  atomicWriteJson(join(input.attemptDir, "record.json"), record, 0o600);
  return {
    record,
    attempt: input.attempt,
    ...(failureClass ? { failureClass } : {}),
    stdoutPath: input.stdoutPath,
    stderrPath: input.stderrPath,
    activityPath: input.activityPath,
    outputTail: input.outputTail,
  };
}

export async function finalizeSuccessfulAttempt(ctx: {
  allPumps: Promise<[OutputSummary, OutputSummary]>;
  options: NormalizedCommandOptions;
  commandId: string;
  attempt: number;
  attemptDir: string;
  stdoutPath: string;
  stderrPath: string;
  activityPath: string;
  startedAt: Date;
  outcome: WatchdogOutcome;
  exitCode: number | null;
  child: ReturnType<BunSpawnApi["spawn"]>;
  uniqueSignals: NodeJS.Signals[];
  evidence: { snapshot: () => FailureSignals };
  outputTail: string;
  activityRecord: ActivityRecord;
  rootProof: boolean;
  rootIdentity: ProcessIdentity | undefined;
  attemptIntent: AttemptIntentController;
}): Promise<AttemptResult> {
  const [stdoutLog, stderrLog] = await raceWithTimeout(
    ctx.allPumps,
    ctx.options.drainTimeoutMs,
    "command pipe drain timeout",
  );
  const finishedAt = new Date();
  ctx.activityRecord.complete("completed", finishedAt);
  const terminalProof =
    ctx.rootProof && ctx.rootIdentity
      ? strongAttemptTerminalProof(ctx.rootIdentity)
      : settledAttemptTerminalProof(ctx.rootIdentity);
  ctx.attemptIntent.markRecordPending("terminal attempt evidence is ready to persist");
  ctx.attemptIntent.markTerminalProof("root and descendant settlement proven", terminalProof);
  return writeSuccessfulAttemptEvidence({
    options: ctx.options,
    commandId: ctx.commandId,
    attempt: ctx.attempt,
    attemptDir: ctx.attemptDir,
    stdoutPath: ctx.stdoutPath,
    stderrPath: ctx.stderrPath,
    activityPath: ctx.activityPath,
    startedAt: ctx.startedAt,
    finishedAt,
    outcome: ctx.outcome,
    exitCode: ctx.exitCode,
    signal: ctx.child.signalCode ?? null,
    signals: ctx.uniqueSignals,
    stdoutLog,
    stderrLog,
    failureSignals: ctx.evidence.snapshot(),
    outputTail: ctx.outputTail,
  });
}
