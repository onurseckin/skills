import { posix } from "node:path";
import type {
  CommandAttemptRecord,
  CommandAttemptStartedRecord,
  CommandLogMetadata,
  CommandRecord,
} from "../contracts/commands.ts";
import { readBoundedBytes, readCanonicalObject, sha256Bytes } from "../core/json.ts";
import { resolveArtifactPath } from "./artifact-paths.ts";
import { attemptStartedIssues } from "./attempt-intent.ts";
import { embeddedCommandIssues, sameCommandJson } from "./command-shape.ts";
import { outputEvidenceIssues } from "./output-evidence.ts";
import { gatePathBindingIssues } from "./gate-path-bindings.ts";
import { MAX_COMMAND_ATTEMPT_BYTES, MAX_COMMAND_RECORD_BYTES } from "./command-record-size.ts";
import { OWNERSHIP_ENV } from "./pipe-ownership.ts";

const MAX_ACTIVITY_BYTES = 1024 * 1024;

function fileIssue(
  runRoot: string,
  metadata: CommandLogMetadata,
  label: string,
  maximum: number,
): string | undefined {
  try {
    const path = resolveArtifactPath(runRoot, metadata.path);
    const bytes = readBoundedBytes(path, maximum);
    if (bytes.byteLength !== metadata.bytes) return `${label} byte count does not match`;
    if (sha256Bytes(bytes) !== metadata.sha256) return `${label} digest does not match`;
  } catch (error) {
    return `${label} is invalid: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

function attemptIssues(
  runRoot: string,
  command: CommandRecord,
  attempt: CommandAttemptRecord,
  index: number,
): string[] {
  const issues: string[] = [];
  const expectedRoot = `${posix.dirname(command.record_path)}/attempt-${index + 1}`;
  if (attempt.id !== command.id || attempt.attempt !== index + 1)
    issues.push(`attempt ${index + 1} identity does not match aggregate command`);
  try {
    const started = readCanonicalObject(
      resolveArtifactPath(runRoot, `${expectedRoot}/attempt-started.json`),
      `command ${command.id} attempt started`,
      { maxBytes: 16 * 1024, maxDepth: 8 },
    );
    issues.push(
      ...attemptStartedIssues(
        started,
        command.id,
        index + 1,
        command.environment?.[OWNERSHIP_ENV],
        command.attempt_signing_public_key,
      ),
    );
    const disposition = (started as unknown as CommandAttemptStartedRecord).cleanup_disposition;
    if (disposition?.status !== "terminal_proof")
      issues.push(`attempt ${index + 1} terminal evidence lacks a signed terminal proof`);
    else if (!sameCommandJson(disposition.signals_sent, attempt.signals_sent))
      issues.push(`attempt ${index + 1} delivered signals do not match marker`);
    if (
      attempt.failure_class === "evidence_failure" &&
      disposition?.proof_kind !== "strong_absence"
    )
      issues.push(`attempt ${index + 1} evidence failure lacks strong terminal proof`);
    if (started.started_at !== attempt.started_at)
      issues.push(`attempt ${index + 1} start timestamp does not match marker`);
  } catch (error) {
    issues.push(`attempt ${index + 1} started marker cannot be read: ${String(error)}`);
  }
  if (attempt.status === "running") issues.push(`attempt ${index + 1} is not terminal`);
  if (
    (attempt.status === "timed_out") !== (attempt.timeout_kind !== null) ||
    (attempt.timeout_kind !== null && attempt.failure_class !== "timeout")
  ) {
    issues.push(`attempt ${index + 1} timeout evidence is inconsistent`);
  }
  if (attempt.failure_class === "host_interruption" && attempt.signals_sent.length === 0)
    issues.push(`attempt ${index + 1} host interruption lacks a host signal`);
  if (attempt.logs.stdout.path !== `${expectedRoot}/stdout.log`)
    issues.push(`attempt ${index + 1} stdout log path is not canonical`);
  if (attempt.logs.stderr.path !== `${expectedRoot}/stderr.log`)
    issues.push(`attempt ${index + 1} stderr log path is not canonical`);
  if (attempt.activity_path !== `${expectedRoot}/activity.json`)
    issues.push(`attempt ${index + 1} activity path is not canonical`);
  if (attempt.activity.path !== attempt.activity_path)
    issues.push(`attempt ${index + 1} activity metadata path does not match`);
  for (const [label, metadata, maximum] of [
    [`attempt ${index + 1} stdout log`, attempt.logs.stdout, command.policy!.max_output_bytes],
    [`attempt ${index + 1} stderr log`, attempt.logs.stderr, command.policy!.max_output_bytes],
    [`attempt ${index + 1} activity`, attempt.activity, MAX_ACTIVITY_BYTES],
  ] as const) {
    const issue = fileIssue(runRoot, metadata, label, maximum);
    if (issue) issues.push(issue);
  }
  if (attempt.logs.stdout.bytes + attempt.logs.stderr.bytes > command.policy!.max_output_bytes)
    issues.push(`attempt ${index + 1} combined output exceeds command quota`);
  try {
    const stdout = readBoundedBytes(
      resolveArtifactPath(runRoot, attempt.logs.stdout.path),
      command.policy!.max_output_bytes,
    );
    const stderr = readBoundedBytes(
      resolveArtifactPath(runRoot, attempt.logs.stderr.path),
      command.policy!.max_output_bytes,
    );
    const detected = outputEvidenceIssues(command.argv, stdout, stderr);
    if (!sameCommandJson(detected, attempt.evidence_issues ?? []))
      issues.push(`attempt ${index + 1} output evidence classification does not match logs`);
  } catch (error) {
    issues.push(`attempt ${index + 1} output evidence cannot be read: ${String(error)}`);
  }
  try {
    const activity = readCanonicalObject(
      resolveArtifactPath(runRoot, attempt.activity_path),
      `command ${command.id} activity`,
      { maxBytes: MAX_ACTIVITY_BYTES, maxDepth: 16 },
    );
    if (
      activity.command_id !== command.id ||
      activity.attempt !== index + 1 ||
      activity.status !==
        (["evidence_failure", "interrupted_unverified"].includes(attempt.failure_class ?? "")
          ? "failed"
          : "completed") ||
      activity.stdout_bytes !== attempt.logs.stdout.bytes ||
      activity.stderr_bytes !== attempt.logs.stderr.bytes
    )
      issues.push(`attempt ${index + 1} activity does not match log evidence`);
  } catch (error) {
    issues.push(`attempt ${index + 1} activity cannot be read: ${String(error)}`);
  }
  try {
    const stored = readCanonicalObject(
      resolveArtifactPath(runRoot, `${expectedRoot}/record.json`),
      `command ${command.id} attempt record`,
      { maxBytes: MAX_COMMAND_ATTEMPT_BYTES, maxDepth: 32 },
    );
    if (!sameCommandJson(stored, attempt))
      issues.push(`attempt ${index + 1} attempt record does not match`);
  } catch (error) {
    issues.push(`attempt ${index + 1} attempt record cannot be read: ${String(error)}`);
  }
  return issues;
}

export function verifyCommandAttempt(
  runRoot: string,
  command: CommandRecord,
  attempt: CommandAttemptRecord,
  index: number,
): string[] {
  try {
    return attemptIssues(runRoot, command, attempt, index);
  } catch (error) {
    return [`attempt ${index + 1} schema is invalid: ${String(error)}`];
  }
}

export function verifyCommandRecord(runRoot: string, record: CommandRecord): string[] {
  const issues = embeddedCommandIssues(record);
  const failedIntegrity =
    record.status === "failed" &&
    (record.preflight_failure !== undefined ||
      record.attempts?.at(-1)?.integrity_failure !== undefined);
  if (record.gate_id !== null && !failedIntegrity) {
    issues.push(
      ...gatePathBindingIssues(
        record.repository_root,
        record.cwd,
        record.argv,
        record.path_bindings,
        record.environment?.PATH,
      ),
    );
  } else if (record.gate_id === null && record.path_bindings !== undefined) {
    issues.push("non-gate command contains gate path bindings");
  }
  if (!record.policy) return issues;
  for (const [index, attempt] of (record.attempts ?? []).entries()) {
    issues.push(...verifyCommandAttempt(runRoot, record, attempt, index));
  }
  try {
    const stored = readCanonicalObject(
      resolveArtifactPath(runRoot, record.record_path),
      `command ${record.id} aggregate record`,
      { maxBytes: MAX_COMMAND_RECORD_BYTES, maxDepth: 64 },
    );
    if (!sameCommandJson(stored, record))
      issues.push("aggregate command record does not match disk");
  } catch (error) {
    issues.push(`aggregate command record cannot be read: ${String(error)}`);
  }
  return issues;
}

export { embeddedCommandIssues } from "./command-shape.ts";
