import type { CommandAttemptRecord, CommandRecord } from "../../core/contracts/index.ts";

type SameJson = (left: unknown, right: unknown) => boolean;

export function aggregateFinalAttemptIssues(
  record: CommandRecord,
  last: CommandAttemptRecord,
  sameJson: SameJson,
): string[] {
  const issues: string[] = [];
  if (
    record.status !== last.status ||
    (record.preflight_failure === undefined && record.finished_at !== last.finished_at) ||
    record.exit_code !== last.exit_code ||
    record.signal !== last.signal ||
    record.timeout_kind !== last.timeout_kind ||
    !sameJson(record.signals_sent ?? [], last.signals_sent) ||
    !sameJson(record.logs, last.logs)
  )
    issues.push("aggregate command does not match its final attempt");
  if (!sameJson(record.evidence_issues ?? [], last.evidence_issues ?? []))
    issues.push("aggregate command evidence issues do not match its final attempt");
  if (
    record.gate_id !== null &&
    record.preflight_failure === undefined &&
    !sameJson(record.repository_after, last.repository_after)
  )
    issues.push("aggregate repository_after does not match its final attempt");
  if (last.integrity_failure !== undefined && record.evidence_error !== last.integrity_failure)
    issues.push("aggregate evidence error does not match its final attempt integrity failure");
  return issues;
}
