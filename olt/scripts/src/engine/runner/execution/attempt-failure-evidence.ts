import { join } from "node:path";
import type { CommandAttemptRecord, CommandLogMetadata } from "../../../core/contracts/index";
import { atomicWriteJson } from "../../../core/durable-write";
import { readBoundedBytes, sha256Bytes } from "../../../core/json";
import { AttemptExecutionError } from "./attempt-execution-error";
import { retainedActivityTimes } from "./attempt-intent";
import { portableArtifactPath } from "../core/artifact-paths";
import { assertCommandAttemptSize, boundedEvidenceError } from "../models/command-record-size";
import { outputEvidenceIssues } from "../receipt/output-evidence";
import type { AttemptResult, NormalizedCommandOptions } from "../types/types";

interface AttemptFailureEvidence {
  runRoot: string;
  commandId: string;
  attempt: number;
  attemptDir: string;
  stdoutPath: string;
  stderrPath: string;
  activityPath: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  signal: string | null;
  signals: NodeJS.Signals[];
  maxOutputBytes: number;
  argv: string[];
  outputTail: string;
  error: unknown;
}

interface AttemptFailureContext {
  options: NormalizedCommandOptions;
  commandId: string;
  attempt: number;
  attemptDir: string;
  startedAt: Date;
  exitCode: number | null;
  signal: string | null;
  signals: NodeJS.Signals[];
  outputTail: string;
  error: unknown;
}

function artifact(path: string, portablePath: string, maximum: number): CommandLogMetadata {
  const bytes = readBoundedBytes(path, maximum);
  return { path: portablePath, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}

export function writeAttemptFailureEvidence(input: AttemptFailureEvidence): AttemptResult {
  const stdoutPortable = portableArtifactPath(input.runRoot, input.stdoutPath);
  const stderrPortable = portableArtifactPath(input.runRoot, input.stderrPath);
  const activityPortable = portableArtifactPath(input.runRoot, input.activityPath);
  const stdout = artifact(input.stdoutPath, stdoutPortable, input.maxOutputBytes);
  const stderr = artifact(input.stderrPath, stderrPortable, input.maxOutputBytes);
  if (stdout.bytes + stderr.bytes > input.maxOutputBytes)
    throw new Error("failed command attempt output exceeds its combined quota");
  const retained = retainedActivityTimes(
    input.activityPath,
    input.commandId,
    input.attempt,
    input.startedAt,
  );
  atomicWriteJson(
    input.activityPath,
    {
      schema: "harness.command-activity",
      version: 1,
      command_id: input.commandId,
      attempt: input.attempt,
      status: "failed",
      started_at: input.startedAt,
      heartbeat_at: input.finishedAt,
      last_observed_heartbeat_at: retained.heartbeatAt,
      last_output_at: retained.lastOutputAt,
      stdout_bytes: stdout.bytes,
      stderr_bytes: stderr.bytes,
      finished_at: input.finishedAt,
    },
    0o600,
  );
  const evidenceIssues = outputEvidenceIssues(
    input.argv,
    readBoundedBytes(input.stdoutPath, input.maxOutputBytes),
    readBoundedBytes(input.stderrPath, input.maxOutputBytes),
  );
  const record: CommandAttemptRecord = {
    id: input.commandId,
    attempt: input.attempt,
    status: "failed",
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    exit_code: input.exitCode,
    signal: input.signal,
    signals_sent: input.signals,
    timeout_kind: null,
    failure_class: "evidence_failure",
    activity_path: activityPortable,
    activity: artifact(input.activityPath, activityPortable, 1024 * 1024),
    logs: { stdout, stderr },
    evidence_issues: evidenceIssues,
    integrity_failure: boundedEvidenceError(input.error),
  };
  assertCommandAttemptSize(record);
  atomicWriteJson(join(input.attemptDir, "record.json"), record, 0o600);
  return {
    record,
    attempt: input.attempt,
    failureClass: "evidence_failure",
    stdoutPath: input.stdoutPath,
    stderrPath: input.stderrPath,
    activityPath: input.activityPath,
    outputTail: input.outputTail,
  };
}

export function createAttemptExecutionError(input: AttemptFailureContext): AttemptExecutionError {
  try {
    const stdoutPath = join(input.attemptDir, "stdout.log");
    const stderrPath = join(input.attemptDir, "stderr.log");
    const activityPath = join(input.attemptDir, "activity.json");
    const result = writeAttemptFailureEvidence({
      runRoot: input.options.runRoot,
      commandId: input.commandId,
      attempt: input.attempt,
      attemptDir: input.attemptDir,
      stdoutPath,
      stderrPath,
      activityPath,
      startedAt: input.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: input.exitCode,
      signal: input.signal,
      signals: input.signals,
      maxOutputBytes: input.options.maxOutputBytes,
      argv: input.options.argv,
      outputTail: input.outputTail,
      error: input.error,
    });
    return new AttemptExecutionError(input.error, result);
  } catch (terminalError) {
    throw new Error(
      `${input.error instanceof Error ? input.error.message : String(input.error)}; terminal attempt evidence failed: ${terminalError instanceof Error ? terminalError.message : String(terminalError)}`,
    );
  }
}
