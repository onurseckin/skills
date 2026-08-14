import { verify } from "node:crypto";
import type {
  CommandAttemptCleanupDisposition,
  CommandAttemptStartedRecord,
} from "../contracts/commands.ts";
import {
  attemptStartedBaseDigest,
  cleanupDispositionEntryDigest,
  cleanupDispositionSigningBytes,
  commandSigningPublicKeyIssues,
  digest,
  dispositionShapeIssues,
  identitiesMatch,
  payloadOf,
  transitionIssues,
  verificationKey,
  MAX_CLEANUP_HISTORY,
  MAX_CLEANUP_REASON_BYTES,
  type CleanupDispositionPayload,
  type CleanupProofKind,
  type DispositionStatus,
} from "./attempt-cleanup-signature.ts";

export {
  attemptStartedBaseDigest,
  cleanupDispositionEntryDigest,
  cleanupDispositionSigningBytes,
  commandSigningPublicKeyIssues,
  MAX_CLEANUP_HISTORY,
  MAX_CLEANUP_REASON_BYTES,
};
export type { CleanupDispositionPayload, CleanupProofKind, DispositionStatus };

export function cleanupDispositionIssues(
  record: Partial<CommandAttemptStartedRecord>,
  expectedVerificationPublicKey: unknown,
): string[] {
  const issues: string[] = [];
  const base = attemptStartedBaseDigest(record);
  const publicKey = verificationKey(record.verification_public_key);
  if (!publicKey) issues.push("attempt started verification public key is invalid");
  if (!verificationKey(expectedVerificationPublicKey))
    issues.push("command intent attempt signing public key is invalid");
  else if (record.verification_public_key !== expectedVerificationPublicKey)
    issues.push("attempt started public key does not match command intent");
  if (record.base_sha256 !== base) issues.push("attempt started base hash does not match");
  if (
    !Array.isArray(record.cleanup_history) ||
    record.cleanup_history.length > MAX_CLEANUP_HISTORY
  )
    return [...issues, "attempt cleanup disposition history is invalid"];
  let previousSha256 = base;
  let previousSignature: string | null = null;
  let previousDisposition: CommandAttemptCleanupDisposition | undefined;
  for (const [index, value] of record.cleanup_history.entries()) {
    const shapeIssues = dispositionShapeIssues(value);
    issues.push(...shapeIssues);
    if (shapeIssues.length > 0 || typeof value !== "object" || value === null) {
      previousSha256 = "invalid";
      previousSignature = null;
      continue;
    }
    const disposition = value as CommandAttemptCleanupDisposition;
    const payload = payloadOf(disposition);
    issues.push(...transitionIssues(previousDisposition, disposition));
    if (disposition.sequence !== index + 1)
      issues.push("attempt cleanup disposition sequence does not match history");
    if (
      disposition.previous_sha256 !== previousSha256 ||
      disposition.previous_signature !== previousSignature
    )
      issues.push("attempt cleanup disposition chain does not match");
    if (
      publicKey &&
      !verify(
        null,
        cleanupDispositionSigningBytes(base, payload),
        publicKey,
        Buffer.from(disposition.signature, "base64"),
      )
    )
      issues.push("attempt cleanup disposition signature does not verify");
    if (
      disposition.sha256 !==
      cleanupDispositionEntryDigest(base, payload, disposition.signature)
    )
      issues.push("attempt cleanup disposition hash does not match");
    previousSha256 = disposition.sha256;
    previousSignature = disposition.signature;
    previousDisposition = disposition;
  }
  if (record.disposition_head_sha256 !== previousSha256)
    issues.push("attempt cleanup disposition head hash does not match");
  const latest = record.cleanup_history.at(-1) ?? null;
  if (
    digest({ disposition: record.cleanup_disposition ?? null }) !==
    digest({ disposition: latest })
  )
    issues.push("attempt cleanup disposition does not match its history");
  if (
    latest &&
    latest.root_pid_identity !== null &&
    !identitiesMatch(latest.root_pid_identity, record.root_pid_identity ?? null)
  )
    issues.push("attempt cleanup disposition root identity does not match marker");
  if (
    latest &&
    latest.status !== "uncertain" &&
    !identitiesMatch(latest.root_pid_identity, record.root_pid_identity ?? null)
  )
    issues.push("attempt terminal transition root identity does not match marker");
  if (
    latest &&
    record.cleanup_history.length > 1 &&
    latest.root_pid_identity === null &&
    record.root_pid_identity != null
  )
    issues.push("attempt cleanup root identity lacks a signed binding transition");
  return issues;
}
