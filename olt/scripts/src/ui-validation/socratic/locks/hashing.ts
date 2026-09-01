import { createHash } from "node:crypto";
import type { ImmutabilityManifest } from "./types.ts";

export function canonicalJsonStringify(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return JSON.stringify(payload);
  }

  if (typeof payload !== "object") {
    return JSON.stringify(payload);
  }

  if (Array.isArray(payload)) {
    const serializedElements = payload.map((item) => canonicalJsonStringify(item));
    return `[${serializedElements.join(",")}]`;
  }

  const entries = Object.entries(payload as Record<string, unknown>)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonStringify(v)}`);

  return `{${entries.join(",")}}`;
}

/**
 * Computes deterministic SHA-256 hex digest of any serializable payload
 */
export function computeSha256(payload: unknown): string {
  const canonicalString = canonicalJsonStringify(payload);
  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

/**
 * Computes manifest signature from core immutable metadata
 */
export function computeManifestSignature(params: {
  sessionId: string;
  roundNumber: number;
  roundName: string;
  sealedScope: readonly string[];
  statePayloadHash: string;
  challengeSummary: { total: number; defended: number; arbitrated: number };
  sealedAt: string;
}): string {
  return computeSha256(params);
}

/**
 * ============================================================================
 * 3. Milestone Lock Engine
 * ============================================================================
 */
