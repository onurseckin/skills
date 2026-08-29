import type { CommandAttemptRecord, CommandRecord } from "../../core/contracts/index.ts";
import type { AttemptResult, FailureClass } from "./types.ts";

export function transientFailure(failure: FailureClass | string | null | undefined): boolean {
  return failure === "network_transient" || failure === "host_interruption";
}

export function applyAttemptRecord(record: CommandRecord, attempt: CommandAttemptRecord): void {
  record.status = attempt.status;
  record.finished_at = attempt.finished_at;
  record.exit_code = attempt.exit_code;
  record.signal = attempt.signal;
  record.timeout_kind = attempt.timeout_kind;
  record.signals_sent = [...attempt.signals_sent];
  record.logs = structuredClone(attempt.logs);
  record.evidence_issues = [...(attempt.evidence_issues ?? [])];
  record.attempts = [...(record.attempts ?? []), structuredClone(attempt)];
}

export function applyAttempt(record: CommandRecord, result: AttemptResult): void {
  applyAttemptRecord(record, result.record);
}

export function replaceFinalAttempt(record: CommandRecord, attempt: CommandAttemptRecord): void {
  const attempts = record.attempts ?? [];
  if (attempts.length === 0 || attempts.at(-1)?.attempt !== attempt.attempt)
    throw new Error("cannot replace a command attempt that is not aggregate-final");
  record.attempts = [...attempts.slice(0, -1), structuredClone(attempt)];
  record.status = attempt.status;
  record.finished_at = attempt.finished_at;
  record.exit_code = attempt.exit_code;
  record.signal = attempt.signal;
  record.timeout_kind = attempt.timeout_kind;
  record.signals_sent = [...attempt.signals_sent];
  record.logs = structuredClone(attempt.logs);
  record.evidence_issues = [...(attempt.evidence_issues ?? [])];
}

export function updateRetryExhaustion(
  record: CommandRecord,
  failure: FailureClass | string | null | undefined,
  retriedAgain: boolean,
): void {
  record.retry_exhausted = Boolean(
    !retriedAgain &&
    transientFailure(failure) &&
    record.policy?.idempotent &&
    (record.attempts?.length ?? 0) > (record.policy?.max_retries ?? -1),
  );
}
