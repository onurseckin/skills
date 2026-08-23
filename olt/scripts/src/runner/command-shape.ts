import { realpathSync } from "node:fs";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { CommandRecord } from "../contracts/commands.ts";
import { aggregateFinalAttemptIssues } from "./command-aggregate-shape.ts";
import { canonicalCommandFingerprint } from "./command-id.ts";
import { policyRecordIssues } from "./policy.ts";
import { gateEnvironmentIssues } from "./gate-environment.ts";
import { gitExecutionArgvIssues } from "./git-execution-shape.ts";
import { commandSigningPublicKeyIssues } from "./attempt-cleanup-disposition.ts";
import { repositoryObservationIssues, sameCommandJson } from "./repository-observation-shape.ts";

export { repositoryObservationIssues, sameCommandJson };

function policyIssues(record: CommandRecord): string[] {
  return record.policy ? policyRecordIssues(record.policy) : ["command policy is missing"];
}

function commandShapeIssues(record: CommandRecord): string[] {
  const issues: string[] = [];
  if (!/^C-[0-9A-Za-z-]+$/u.test(record.id)) issues.push("command id is invalid");
  if (typeof record.actor !== "string" || !record.actor.trim())
    issues.push("command actor is invalid");
  if (record.task_id !== null && (typeof record.task_id !== "string" || !record.task_id.trim()))
    issues.push("command task id is invalid");
  if (record.gate_id !== null && (typeof record.gate_id !== "string" || !record.gate_id.trim()))
    issues.push("command gate id is invalid");
  if (!Array.isArray(record.argv) || record.argv.length === 0 || record.argv.some((part) => !part))
    issues.push("command argv is invalid");
  if (record.cwd_relative.startsWith("/") || record.cwd_relative.split("/").includes(".."))
    issues.push("command cwd_relative is invalid");
  const expectedCwd = relative(record.repository_root, record.cwd);
  if (
    !isAbsolute(record.repository_root) ||
    realpathSync(record.repository_root) !== record.repository_root ||
    realpathSync(record.cwd) !== record.cwd ||
    resolve(record.repository_root, expectedCwd) !== record.cwd ||
    (expectedCwd ? expectedCwd.split(sep).join("/") : ".") !== record.cwd_relative
  )
    issues.push("command cwd_relative does not match canonical repository identity");
  if (
    posix.basename(record.record_path) !== "record.json" ||
    posix.basename(posix.dirname(record.record_path)) !== record.id
  )
    issues.push("command record path is invalid");
  if (canonicalCommandFingerprint(record.cwd, record.argv) !== record.fingerprint)
    issues.push("command fingerprint does not bind cwd and argv");
  issues.push(...commandSigningPublicKeyIssues(record.attempt_signing_public_key));
  issues.push(...gateEnvironmentIssues(record.environment));
  issues.push(...gitExecutionArgvIssues(record));
  if (record.gate_id !== null) {
    if (record.assurance !== "trusted_host_observed_v1")
      issues.push("gate command assurance is missing or invalid");
    issues.push(...repositoryObservationIssues(record.repository_before, "repository_before"));
    if (record.repository_after !== null)
      issues.push(...repositoryObservationIssues(record.repository_after, "repository_after"));
    if (record.repository_after === undefined) issues.push("repository_after is missing");
    if (record.status === "running" && record.repository_after !== null)
      issues.push("running command repository_after is not pristine");
  } else {
    if (
      record.assurance !== undefined ||
      record.repository_before !== undefined ||
      record.repository_after !== undefined
    )
      issues.push("non-gate command contains trusted-host assurance");
  }
  if (
    record.preflight_failure !== undefined &&
    (record.gate_id === null ||
      record.status !== "failed" ||
      record.preflight_failure !== record.evidence_error ||
      !record.preflight_failure.trim())
  )
    issues.push("command preflight failure is invalid");
  if (record.retry_pending !== undefined && record.retry_pending !== true)
    issues.push("command retry pending marker is invalid");
  issues.push(...policyIssues(record));
  const attempts = record.attempts ?? [];
  if (
    record.evidence_error !== undefined &&
    (typeof record.evidence_error !== "string" ||
      !record.evidence_error.trim() ||
      record.status !== "failed")
  )
    issues.push("command evidence error is invalid");
  if (record.status === "succeeded" && attempts.length === 0)
    issues.push("succeeded command has no attempt evidence");
  if (
    record.gate_id !== null &&
    record.status !== "running" &&
    attempts.length === 0 &&
    (record.status !== "failed" || record.preflight_failure !== record.evidence_error)
  )
    issues.push("zero-attempt gate is not a failed preflight");
  if (record.retry_pending && attempts.length === 0)
    issues.push("command retry pending evidence has no attempt");
  if (record.status === "running" && (record.finished_at !== null || attempts.length !== 0))
    issues.push("running command intent is not pristine");
  if (record.status !== "running" && !record.evidence_error && attempts.length === 0)
    issues.push("terminal command has no attempt evidence");
  if (record.policy && attempts.length > record.policy.max_retries + 1)
    issues.push("command retry history exceeds policy");
  if (record.policy && attempts.length > 1 && !record.policy.idempotent)
    issues.push("non-idempotent command contains retry history");
  for (const attempt of attempts.slice(0, -1)) {
    if (attempt.integrity_failure !== undefined)
      issues.push("attempt integrity failure cannot be retried");
    if (attempt.status === "succeeded") issues.push("a succeeded attempt cannot be retried");
    if (!(["network_transient", "host_interruption"] as unknown[]).includes(attempt.failure_class))
      issues.push("command retried a non-transient failure");
  }
  for (const attempt of attempts) {
    if (
      record.gate_id !== null &&
      (typeof attempt.gate_finalized_at !== "string" ||
        !Number.isFinite(Date.parse(attempt.gate_finalized_at)))
    )
      issues.push("gate attempt finalization timestamp is invalid");
    if (record.gate_id === null && attempt.gate_finalized_at !== undefined)
      issues.push("non-gate attempt contains gate finalization evidence");
    if (record.gate_id !== null)
      issues.push(
        ...repositoryObservationIssues(attempt.repository_after, "gate attempt repository_after"),
      );
    else if (attempt.repository_after !== undefined)
      issues.push("non-gate attempt contains repository_after evidence");
    if (
      attempt.integrity_failure !== undefined &&
      (typeof attempt.integrity_failure !== "string" || !attempt.integrity_failure.trim())
    )
      issues.push("attempt integrity failure is invalid");
    if (attempt.integrity_failure !== undefined && attempt.status !== "failed")
      issues.push("attempt integrity failure is not terminal failed");
    if (
      record.gate_id !== null &&
      attempt.repository_after !== undefined &&
      !sameCommandJson(record.repository_before, attempt.repository_after) &&
      attempt.integrity_failure === undefined
    )
      issues.push("gate repository drift lacks an attempt integrity failure");
    if (
      attempt.evidence_issues !== undefined &&
      (!Array.isArray(attempt.evidence_issues) ||
        attempt.evidence_issues.some((issue) => typeof issue !== "string" || !issue.trim()))
    )
      issues.push("attempt evidence issues are invalid");
    if (
      attempt.status === "succeeded" &&
      (attempt.exit_code !== 0 || attempt.signal !== null || attempt.failure_class !== null)
    )
      issues.push("succeeded attempt contradicts its exit or failure evidence");
    if (attempt.failure_class === "network_transient" && attempt.status === "succeeded")
      issues.push("transient failure attempt cannot be succeeded");
    if (
      (attempt.evidence_issues?.length ?? 0) > 0 &&
      (attempt.status !== "failed" ||
        !["evidence_failure", "interrupted_unverified", "test_failure"].includes(
          attempt.failure_class ?? "",
        ))
    )
      issues.push("attempt output evidence is not represented as a terminal test failure");
  }
  if (attempts.length > 0) {
    const last = attempts.at(-1)!;
    issues.push(...aggregateFinalAttemptIssues(record, last, sameCommandJson));
    const exhausted =
      record.policy?.idempotent === true &&
      (["network_transient", "host_interruption"] as unknown[]).includes(last.failure_class) &&
      attempts.length === (record.policy?.max_retries ?? -1) + 1;
    const stoppedWithRetriesRemaining =
      record.policy?.idempotent === true &&
      (["network_transient", "host_interruption"] as unknown[]).includes(last.failure_class) &&
      attempts.length < (record.policy?.max_retries ?? -1) + 1;
    if (record.retry_pending && (!stoppedWithRetriesRemaining || !record.evidence_error))
      issues.push("command retry pending evidence is invalid");
    if (stoppedWithRetriesRemaining && !record.evidence_error)
      issues.push("aggregate retry stopped with transient attempts remaining");
    if (!record.evidence_error && record.retry_exhausted !== exhausted)
      issues.push("aggregate retry exhaustion does not match attempt history");
  }
  return issues;
}

export function embeddedCommandIssues(record: CommandRecord): string[] {
  try {
    return commandShapeIssues(record);
  } catch (error) {
    return [`command record schema is invalid: ${String(error)}`];
  }
}
