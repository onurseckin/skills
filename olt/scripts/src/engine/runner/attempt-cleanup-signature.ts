import { createPublicKey } from "node:crypto";
import type {
  CommandAttemptCleanupDisposition,
  CommandAttemptStartedRecord,
} from "../../core/contracts/commands.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../core/json.ts";
import {
  dispositionShapeIssues,
  identitiesMatch,
  identityValid,
  signalLedgerValid,
  transitionIssues,
} from "./attempt-cleanup-validation.ts";

export {
  dispositionShapeIssues,
  identitiesMatch,
  identityValid,
  signalLedgerValid,
  transitionIssues,
};

export const MAX_CLEANUP_REASON_BYTES = 512;
export const MAX_CLEANUP_HISTORY = 12;
export const MAX_PUBLIC_KEY_BYTES = 128;
export const ED25519_SIGNATURE_BYTES = 64;
export const SHA256 = /^[0-9a-f]{64}$/u;
export const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
export const SIGNATURE_DOMAIN = "harness.command-attempt-cleanup-disposition/v1";
export const ENTRY_DOMAIN = "harness.command-attempt-cleanup-entry/v1";

export type DispositionStatus = CommandAttemptCleanupDisposition["status"];
export type CleanupProofKind = CommandAttemptCleanupDisposition["proof_kind"];

export interface CleanupDispositionPayload extends JsonObject {
  status: DispositionStatus;
  sequence: number;
  recorded_at: string;
  reason: string;
  signals_sent: string[];
  root_pid_identity: import("../../core/contracts/commands.ts").CommandProcessIdentity | null;
  proof_kind: CleanupProofKind;
  previous_sha256: string;
  previous_signature: string | null;
}

export function digest(value: JsonObject): string {
  return sha256Bytes(canonicalJsonBytes(value));
}

export function baseFields(record: Partial<CommandAttemptStartedRecord>): JsonObject {
  return {
    schema: record.schema ?? null,
    version: record.version ?? null,
    command_id: record.command_id ?? null,
    attempt: record.attempt ?? null,
    status: record.status ?? null,
    started_at: record.started_at ?? null,
    ownership_token_sha256: record.ownership_token_sha256 ?? null,
    verification_public_key: record.verification_public_key ?? null,
  };
}

export function attemptStartedBaseDigest(record: Partial<CommandAttemptStartedRecord>): string {
  return digest(baseFields(record));
}

export function cleanupDispositionSigningBytes(
  baseSha256: string,
  disposition: CleanupDispositionPayload,
): Uint8Array {
  return canonicalJsonBytes({
    domain: SIGNATURE_DOMAIN,
    base_sha256: baseSha256,
    disposition,
  });
}

export function cleanupDispositionEntryDigest(
  baseSha256: string,
  disposition: CleanupDispositionPayload,
  signature: string,
): string {
  return digest({
    domain: ENTRY_DOMAIN,
    base_sha256: baseSha256,
    disposition,
    signature,
  });
}

export function canonicalBase64(value: unknown, exactBytes?: number): Buffer | undefined {
  if (typeof value !== "string" || !BASE64.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (exactBytes && decoded.byteLength !== exactBytes))
    return undefined;
  return decoded;
}

export function verificationKey(value: unknown): ReturnType<typeof createPublicKey> | undefined {
  const bytes = canonicalBase64(value);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_PUBLIC_KEY_BYTES) return undefined;
  try {
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") return undefined;
    const canonical = key.export({ format: "der", type: "spki" });
    return Buffer.from(canonical).equals(bytes) ? key : undefined;
  } catch {
    return undefined;
  }
}

export function commandSigningPublicKeyIssues(value: unknown): string[] {
  return verificationKey(value) ? [] : ["command attempt signing public key is invalid"];
}

export function payloadOf(
  disposition: CommandAttemptCleanupDisposition,
): CleanupDispositionPayload {
  const { sha256: _sha256, signature: _signature, ...payload } = disposition;
  return payload;
}

export function boundedReason(value: string): string {
  const reason = value || "unrecorded cleanup outcome";
  let low = 0;
  let high = reason.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (new TextEncoder().encode(reason.slice(0, middle)).byteLength <= MAX_CLEANUP_REASON_BYTES)
      low = middle;
    else high = middle - 1;
  }
  return reason.slice(0, low);
}
