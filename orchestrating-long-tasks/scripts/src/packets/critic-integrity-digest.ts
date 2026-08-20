import type { JsonObject } from "../contracts/json.ts";
import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";

/**
 * Ties a critic review to the packet it answers. Each observation's event head is dropped first:
 * publishing the packet appends its own packet-prepared and packet-published events, so the head has
 * always moved on by the time the critic answers. What the two must still agree on is the finding —
 * whether the capsule verified clean and which issues the check reported.
 */
export function criticIntegrityDigest(evidence: readonly JsonObject[]): string {
  const findings = evidence.map(({ event_head: _head, ...finding }) => finding);
  return sha256Bytes(canonicalJsonBytes(findings));
}
