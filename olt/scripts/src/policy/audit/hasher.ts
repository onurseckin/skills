import { createHash } from "node:crypto";
import type { AuditEvent, IntegrityCheckResult } from "./types.ts";

export function computeAuditRecordHash(event: Omit<AuditEvent, "hash">): string {
  const payload = JSON.stringify({
    id: event.id,
    timestamp: event.timestamp,
    sequenceNumber: event.sequenceNumber,
    category: event.category,
    action: event.action,
    actor: event.actor,
    severity: event.severity,
    outcome: event.outcome,
    target: event.target ?? null,
    details: event.details,
    previousHash: event.previousHash ?? null,
  });

  return createHash("sha256").update(payload).digest("hex");
}

export function verifyAuditTrailChain(events: readonly AuditEvent[]): IntegrityCheckResult {
  if (events.length === 0) {
    return {
      valid: true,
      totalEventsChecked: 0,
    };
  }

  let prevHash: string | undefined = undefined;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) {
      return {
        valid: false,
        totalEventsChecked: i,
        brokenAtIndex: i,
        error: "Encountered undefined audit record in sequence",
      };
    }

    if (i === 0) {
      if (event.previousHash !== undefined) {
        return {
          valid: false,
          totalEventsChecked: i + 1,
          brokenAtIndex: 0,
          error: "Genesis event must not have a previousHash",
        };
      }
    } else {
      if (event.previousHash !== prevHash) {
        return {
          valid: false,
          totalEventsChecked: i + 1,
          brokenAtIndex: i,
          expectedHash: prevHash,
          actualHash: event.previousHash,
          error: `Hash chain broken at index ${i}: previousHash mismatch`,
        };
      }
    }

    const expectedCalculatedHash = computeAuditRecordHash({
      id: event.id,
      timestamp: event.timestamp,
      sequenceNumber: event.sequenceNumber,
      category: event.category,
      action: event.action,
      actor: event.actor,
      severity: event.severity,
      outcome: event.outcome,
      target: event.target,
      details: event.details,
      previousHash: event.previousHash,
    });

    if (event.hash !== expectedCalculatedHash) {
      return {
        valid: false,
        totalEventsChecked: i + 1,
        brokenAtIndex: i,
        expectedHash: expectedCalculatedHash,
        actualHash: event.hash,
        error: `Payload tamper detected at index ${i}: hash signature does not match content`,
      };
    }

    prevHash = event.hash;
  }

  return {
    valid: true,
    totalEventsChecked: events.length,
  };
}
