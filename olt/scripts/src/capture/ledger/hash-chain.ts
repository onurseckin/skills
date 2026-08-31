import { createHash } from "node:crypto";
import type { CaptureEventRecord, LedgerVerificationResult } from "./types.ts";

export const GENESIS_HASH = "0".repeat(64);

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function computeEventHash(
  prevHash: string,
  event: Omit<CaptureEventRecord, "hash">,
): string {
  const payloadJson = canonicalJson(event.payload);
  const composite = `${event.sequenceNumber}:${event.eventId}:${event.timestamp}:${event.eventType}:${prevHash}:${payloadJson}:${event.actor ?? ""}`;
  return createHash("sha256").update(composite).digest("hex");
}

export function verifyEventChain(events: readonly CaptureEventRecord[]): LedgerVerificationResult {
  if (events.length === 0) {
    return {
      valid: true,
      totalEvents: 0,
      latestHash: GENESIS_HASH,
    };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) {
      continue;
    }
    const expectedSequence = i + 1;

    if (event.sequenceNumber !== expectedSequence) {
      return {
        valid: false,
        totalEvents: events.length,
        latestHash: events[events.length - 1]?.hash ?? GENESIS_HASH,
        corruptedSequenceNumber: event.sequenceNumber,
        error: `Sequence mismatch at index ${i}: expected ${expectedSequence}, found ${event.sequenceNumber}`,
      };
    }

    if (event.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalEvents: events.length,
        latestHash: events[events.length - 1]?.hash ?? GENESIS_HASH,
        corruptedSequenceNumber: event.sequenceNumber,
        error: `Broken hash chain at sequence ${event.sequenceNumber}: prevHash '${event.prevHash}' does not match expected '${expectedPrevHash}'`,
      };
    }

    const calculatedHash = computeEventHash(expectedPrevHash, {
      sequenceNumber: event.sequenceNumber,
      eventId: event.eventId,
      timestamp: event.timestamp,
      eventType: event.eventType,
      payload: event.payload,
      prevHash: event.prevHash,
      actor: event.actor,
    });

    if (calculatedHash !== event.hash) {
      return {
        valid: false,
        totalEvents: events.length,
        latestHash: events[events.length - 1]?.hash ?? GENESIS_HASH,
        corruptedSequenceNumber: event.sequenceNumber,
        error: `Tampered payload hash at sequence ${event.sequenceNumber}: stored '${event.hash}', computed '${calculatedHash}'`,
      };
    }

    expectedPrevHash = event.hash;
  }

  const lastEvent = events[events.length - 1];

  return {
    valid: true,
    totalEvents: events.length,
    latestHash: lastEvent?.hash ?? GENESIS_HASH,
  };
}
