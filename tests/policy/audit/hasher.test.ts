import { describe, expect, it } from "bun:test";
import {
  computeAuditRecordHash,
  verifyAuditTrailChain,
} from "../../../olt/scripts/src/policy/audit/hasher.ts";
import type { AuditEvent } from "../../../olt/scripts/src/policy/audit/types.ts";

describe("Audit Hasher and Chain Verification", () => {
  it("verifies empty audit trail chain", () => {
    const res = verifyAuditTrailChain([]);
    expect(res.valid).toBe(true);
    expect(res.totalEventsChecked).toBe(0);
  });

  it("handles undefined event entries in chain array", () => {
    const rawArray = [undefined as unknown as AuditEvent];
    const res = verifyAuditTrailChain(rawArray);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Encountered undefined audit record in sequence");
    expect(res.brokenAtIndex).toBe(0);
  });

  it("fails if genesis event specifies previousHash", () => {
    const genesis: AuditEvent = {
      id: "ev-1",
      timestamp: "2026-08-30T00:00:00.000Z",
      sequenceNumber: 0,
      category: "rbac",
      action: "test_action",
      actor: { id: "actor-1" },
      severity: "info",
      outcome: "allowed",
      details: {},
      previousHash: "some_prev_hash",
      hash: "some_hash",
    };

    const res = verifyAuditTrailChain([genesis]);
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Genesis event must not have a previousHash");
    expect(res.brokenAtIndex).toBe(0);
  });

  it("fails if subsequent event previousHash does not match previous event hash", () => {
    const event0Payload = {
      id: "ev-1",
      timestamp: "2026-08-30T00:00:00.000Z",
      sequenceNumber: 0,
      category: "rbac" as const,
      action: "action-1",
      actor: { id: "actor-1" },
      severity: "info" as const,
      outcome: "allowed" as const,
      details: {},
    };
    const hash0 = computeAuditRecordHash(event0Payload);
    const event0: AuditEvent = { ...event0Payload, hash: hash0 };

    const event1Payload = {
      id: "ev-2",
      timestamp: "2026-08-30T00:01:00.000Z",
      sequenceNumber: 1,
      category: "rbac" as const,
      action: "action-2",
      actor: { id: "actor-1" },
      severity: "info" as const,
      outcome: "allowed" as const,
      details: {},
      previousHash: "wrong_previous_hash",
    };
    const hash1 = computeAuditRecordHash(event1Payload);
    const event1: AuditEvent = { ...event1Payload, hash: hash1 };

    const res = verifyAuditTrailChain([event0, event1]);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Hash chain broken at index 1: previousHash mismatch");
    expect(res.brokenAtIndex).toBe(1);
    expect(res.expectedHash).toBe(hash0);
  });

  it("fails if event payload was tampered causing hash mismatch", () => {
    const event0Payload = {
      id: "ev-1",
      timestamp: "2026-08-30T00:00:00.000Z",
      sequenceNumber: 0,
      category: "rbac" as const,
      action: "action-1",
      actor: { id: "actor-1" },
      severity: "info" as const,
      outcome: "allowed" as const,
      details: {},
    };
    const event0: AuditEvent = { ...event0Payload, hash: "tampered_hash_signature" };

    const res = verifyAuditTrailChain([event0]);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Payload tamper detected at index 0");
    expect(res.brokenAtIndex).toBe(0);
  });
});
