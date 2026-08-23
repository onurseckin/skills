import type {
  CommandAttemptCleanupDisposition,
  CommandProcessIdentity,
} from "../../contracts/commands.ts";
import {
  canonicalBase64,
  digest,
  ED25519_SIGNATURE_BYTES,
  MAX_CLEANUP_REASON_BYTES,
  SHA256,
} from "./attempt-cleanup-signature.ts";

export function identityValid(value: unknown): value is CommandProcessIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const identity = value as Partial<CommandProcessIdentity>;
  return (
    Number.isSafeInteger(identity.pid) &&
    identity.pid! > 1 &&
    Number.isSafeInteger(identity.parent) &&
    identity.parent! > 0 &&
    Number.isSafeInteger(identity.group) &&
    identity.group! > 1 &&
    typeof identity.birth === "string" &&
    Boolean(identity.birth)
  );
}

export function signalLedgerValid(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.some((signal) => signal !== "SIGTERM" && signal !== "SIGKILL")) return false;
  if (new Set(value).size !== value.length) return false;
  return (
    value.length === 0 ||
    (value.length === 1 && value[0] === "SIGTERM") ||
    (value.length === 2 && value[0] === "SIGTERM" && value[1] === "SIGKILL")
  );
}

export function dispositionShapeIssues(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return ["attempt cleanup disposition is invalid"];
  const disposition = value as Partial<CommandAttemptCleanupDisposition>;
  const issues: string[] = [];
  if (!["uncertain", "record_pending", "terminal_proof"].includes(String(disposition.status)))
    issues.push("attempt cleanup disposition status is invalid");
  if (!Number.isSafeInteger(disposition.sequence) || disposition.sequence! < 1)
    issues.push("attempt cleanup disposition sequence is invalid");
  if (
    typeof disposition.recorded_at !== "string" ||
    !Number.isFinite(Date.parse(disposition.recorded_at))
  )
    issues.push("attempt cleanup disposition timestamp is invalid");
  if (
    typeof disposition.reason !== "string" ||
    !disposition.reason.trim() ||
    new TextEncoder().encode(disposition.reason).byteLength > MAX_CLEANUP_REASON_BYTES
  )
    issues.push("attempt cleanup disposition reason is invalid");
  if (!signalLedgerValid(disposition.signals_sent))
    issues.push("attempt cleanup disposition signals are invalid");
  if (disposition.root_pid_identity !== null && !identityValid(disposition.root_pid_identity))
    issues.push("attempt cleanup disposition root identity is invalid");
  if (disposition.status === "terminal_proof") {
    if (!["settled", "strong_absence"].includes(String(disposition.proof_kind)))
      issues.push("attempt terminal proof kind is invalid");
    if (
      disposition.proof_kind === "strong_absence" &&
      !identityValid(disposition.root_pid_identity)
    )
      issues.push("attempt strong terminal proof lacks a root identity");
  } else if (disposition.proof_kind !== null) {
    issues.push("nonterminal cleanup disposition contains terminal proof");
  }
  if (!SHA256.test(String(disposition.previous_sha256)))
    issues.push("attempt cleanup disposition previous hash is invalid");
  if (
    disposition.previous_signature !== null &&
    !canonicalBase64(disposition.previous_signature, ED25519_SIGNATURE_BYTES)
  )
    issues.push("attempt cleanup disposition previous signature is invalid");
  if (!canonicalBase64(disposition.signature, ED25519_SIGNATURE_BYTES))
    issues.push("attempt cleanup disposition signature is invalid");
  if (!SHA256.test(String(disposition.sha256)))
    issues.push("attempt cleanup disposition hash is invalid");
  return issues;
}

export function identitiesMatch(
  left: CommandProcessIdentity | null,
  right: CommandProcessIdentity | null,
): boolean {
  return digest({ identity: left }) === digest({ identity: right });
}

export function transitionIssues(
  previous: CommandAttemptCleanupDisposition | undefined,
  current: CommandAttemptCleanupDisposition,
): string[] {
  const issues: string[] = [];
  if (!previous) {
    if (current.status !== "uncertain")
      issues.push("attempt cleanup disposition first transition must be uncertain");
    if (current.signals_sent.length !== 0)
      issues.push("attempt cleanup disposition initial signal ledger is invalid");
    if (current.root_pid_identity !== null)
      issues.push("attempt cleanup disposition initial root identity is invalid");
    return issues;
  }
  if (previous.status === "terminal_proof")
    issues.push("attempt cleanup disposition appears after terminal finality");
  if (current.status === "record_pending" && previous.status !== "uncertain")
    issues.push("attempt record-pending transition requires uncertainty");
  if (current.status === "terminal_proof" && previous.status !== "record_pending")
    issues.push("attempt terminal-proof transition requires record-pending");
  const priorSignals = previous.signals_sent;
  const signals = current.signals_sent;
  const prefixMatches = priorSignals.every((signal, index) => signals[index] === signal);
  if (
    !prefixMatches ||
    signals.length < priorSignals.length ||
    signals.length > priorSignals.length + 1
  )
    issues.push("attempt cleanup disposition signal ledger is not monotonic");
  if (
    signals.length !== priorSignals.length &&
    (previous.status !== "uncertain" || current.status !== "uncertain")
  )
    issues.push("attempt cleanup signal transition requires continuing uncertainty");
  if (previous.root_pid_identity !== null) {
    if (!identitiesMatch(previous.root_pid_identity, current.root_pid_identity))
      issues.push("attempt cleanup disposition root identity was substituted");
  } else if (current.root_pid_identity !== null && current.status !== "uncertain") {
    issues.push("attempt cleanup root binding requires an uncertainty transition");
  }
  return issues;
}
