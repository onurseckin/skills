import { existsSync } from "node:fs";
import { posix } from "node:path";
import type {
  CommandAttemptRecord,
  CommandAttemptStartedRecord,
  CommandLogMetadata,
  CommandRecord,
} from "../core/contracts/index.ts";
import { atomicWriteBytes, atomicWriteJson } from "../core/durable-write.ts";
import { readBoundedBytes, readCanonicalObject, sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../core/errors/index.ts";
import {
  attemptStartedIssues,
  probeAttemptProcess,
  retainedActivityTimes,
  type AttemptProcessProof,
} from "../engine/runner/execution/attempt-intent";
import { resolveArtifactPath } from "../engine/runner/core/artifact-paths";
import { outputEvidenceIssues } from "../engine/runner/receipt/output-evidence";
import { OWNERSHIP_ENV } from "../engine/runner/core/pipe-ownership";
import type { ProcessIdentity } from "../engine/runner/process/process-identity";
import { assertCommandAttemptSize } from "../engine/runner/models/command-record-size";

const MAX_ACTIVITY_BYTES = 1024 * 1024;
const INTERRUPTED = "attempt interrupted before terminal evidence was durable";

export interface AttemptReconciliationDependencies {
  probeProcess: (identity: ProcessIdentity) => AttemptProcessProof;
  inspectRepository: typeof import("../packets/repository-identity.ts").inspectRepositoryBinding;
  now: () => Date;
}

export function artifact(path: string, portablePath: string, maximum: number): CommandLogMetadata {
  if (!existsSync(path)) atomicWriteBytes(path, new Uint8Array(), { mode: 0o600 });
  const bytes = readBoundedBytes(path, maximum);
  return { path: portablePath, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}

export function readStarted(
  path: string,
  intent: CommandRecord,
  attempt: number,
): CommandAttemptStartedRecord {
  const started = readCanonicalObject(path, `command ${intent.id} attempt started`, {
    maxBytes: 16 * 1024,
    maxDepth: 8,
  }) as unknown as CommandAttemptStartedRecord;
  const issues = attemptStartedIssues(
    started,
    intent.id,
    attempt,
    intent.environment?.[OWNERSHIP_ENV],
    intent.attempt_signing_public_key,
  );
  if (issues.length > 0)
    throw new HarnessError("INTEGRITY", `durable attempt start is invalid: ${issues.join("; ")}`);
  return started;
}

export function interruptedAttempt(
  runRoot: string,
  intent: CommandRecord,
  directory: string,
  started: CommandAttemptStartedRecord,
  finishedAt: string,
): CommandAttemptRecord {
  const base = `${posix.dirname(intent.record_path)}/attempt-${started.attempt}`;
  const stdoutPath = resolveArtifactPath(runRoot, `${base}/stdout.log`);
  const stderrPath = resolveArtifactPath(runRoot, `${base}/stderr.log`);
  const stdout = artifact(stdoutPath, `${base}/stdout.log`, intent.policy!.max_output_bytes);
  const stderr = artifact(stderrPath, `${base}/stderr.log`, intent.policy!.max_output_bytes);
  const activityPath = resolveArtifactPath(runRoot, `${base}/activity.json`);
  const activityTimes = retainedActivityTimes(
    activityPath,
    intent.id,
    started.attempt,
    started.started_at,
  );
  atomicWriteJson(
    activityPath,
    {
      schema: "harness.command-activity",
      version: 1,
      command_id: intent.id,
      attempt: started.attempt,
      status: "failed",
      started_at: started.started_at,
      heartbeat_at: finishedAt,
      last_observed_heartbeat_at: activityTimes.heartbeatAt,
      last_output_at: activityTimes.lastOutputAt,
      stdout_bytes: stdout.bytes,
      stderr_bytes: stderr.bytes,
      finished_at: finishedAt,
    },
    0o600,
  );
  const record: CommandAttemptRecord = {
    id: intent.id,
    attempt: started.attempt,
    status: "failed",
    started_at: started.started_at,
    finished_at: finishedAt,
    exit_code: null,
    signal: null,
    signals_sent: [...started.cleanup_disposition!.signals_sent],
    timeout_kind: null,
    failure_class: "interrupted_unverified",
    activity_path: `${base}/activity.json`,
    activity: artifact(activityPath, `${base}/activity.json`, MAX_ACTIVITY_BYTES),
    logs: { stdout, stderr },
    evidence_issues: outputEvidenceIssues(
      intent.argv,
      readBoundedBytes(stdoutPath, intent.policy!.max_output_bytes),
      readBoundedBytes(stderrPath, intent.policy!.max_output_bytes),
    ),
    integrity_failure: INTERRUPTED,
  };
  assertCommandAttemptSize(record);
  atomicWriteJson(`${directory}/record.json`, record, 0o600);
  return record;
}

export function recoverIncomplete(
  runRoot: string,
  intent: CommandRecord,
  directory: string,
  attempt: number,
  dependencies: AttemptReconciliationDependencies,
): CommandAttemptRecord | undefined {
  const started = readStarted(`${directory}/attempt-started.json`, intent, attempt);
  if (
    started.cleanup_disposition?.status !== "terminal_proof" ||
    started.cleanup_disposition.proof_kind !== "strong_absence"
  )
    return undefined;
  const root = started.root_pid_identity;
  if (!root || dependencies.probeProcess(root) !== "absent") return undefined;
  return interruptedAttempt(runRoot, intent, directory, started, dependencies.now().toISOString());
}
