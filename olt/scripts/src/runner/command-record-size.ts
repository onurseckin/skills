import type { CommandAttemptRecord, CommandRecord } from "../contracts/commands.ts";
import { canonicalJsonBytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { MAX_COMMAND_RETRIES } from "./policy.ts";

export const MAX_COMMAND_RECORD_BYTES = 16 * 1024 * 1024;
export const MAX_COMMAND_INTENT_BYTES = 8 * 1024 * 1024;
export const MAX_COMMAND_ATTEMPT_BYTES = 1024 * 1024;
export const MAX_COMMAND_ATTEMPTS = MAX_COMMAND_RETRIES + 1;
export const MAX_EVIDENCE_ERROR_BYTES = 64 * 1024;

function assertSize(
  value: CommandRecord | CommandAttemptRecord,
  maximum: number,
  label: string,
): void {
  if (canonicalJsonBytes(value).byteLength > maximum)
    throw new HarnessError("INVALID_STATE", `${label} exceeds size limit`);
}

export function assertCommandIntentSize(record: CommandRecord): void {
  assertSize(record, MAX_COMMAND_INTENT_BYTES, "command intent");
}

export function assertCommandRecordSize(record: CommandRecord): void {
  assertSize(record, MAX_COMMAND_RECORD_BYTES, "command record");
}

export function assertCommandAttemptSize(record: CommandAttemptRecord): void {
  assertSize(record, MAX_COMMAND_ATTEMPT_BYTES, "command attempt record");
}

export function boundedEvidenceError(error: unknown): string {
  let value = "command execution failed with an unprintable error";
  try {
    const described = error instanceof Error ? error.message : String(error);
    if (described) value = described;
  } catch {}
  if (canonicalJsonBytes(value).byteLength <= MAX_EVIDENCE_ERROR_BYTES) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (canonicalJsonBytes(value.slice(0, middle)).byteLength <= MAX_EVIDENCE_ERROR_BYTES)
      low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
}
