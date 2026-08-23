import type { JsonObject } from "../contracts/json.ts";
import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";

export function criticIntegrityDigest(evidence: readonly JsonObject[]): string {
  const findings = evidence.map(({ event_head: _head, ...finding }) => finding);
  return sha256Bytes(canonicalJsonBytes(findings));
}
