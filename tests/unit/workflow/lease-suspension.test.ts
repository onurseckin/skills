import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../olt/scripts/src/contracts/json.ts";
import {
  isLeaseSuspended,
  leaseIsExpired,
  restoreLease,
  suspendLease,
} from "../../../olt/scripts/src/workflow/lease/suspension.ts";

const t0 = new Date("2026-08-19T00:00:00.000Z");

function lease(overrides: JsonObject = {}): JsonObject {
  return {
    expires_at: new Date(t0.valueOf() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("isLeaseSuspended", () => {
  test("false when suspended_at is absent", () => {
    expect(isLeaseSuspended(lease())).toBe(false);
  });

  test("false when suspended_at is present but not a string", () => {
    expect(isLeaseSuspended(lease({ suspended_at: 1 }))).toBe(false);
  });

  test("true when suspended_at is a string", () => {
    expect(isLeaseSuspended(lease({ suspended_at: t0.toISOString() }))).toBe(true);
  });
});

describe("suspendLease", () => {
  test("stamps suspended_at with the given clock as an ISO string", () => {
    const record = lease();
    suspendLease(record, t0);
    expect(record.suspended_at).toBe(t0.toISOString());
  });

  test("refuses to suspend a lease that is already suspended", () => {
    const record = lease({ suspended_at: t0.toISOString() });
    expect(() => suspendLease(record, t0)).toThrow(/already suspended/);
  });
});

describe("restoreLease", () => {
  test("refuses to restore a lease that was never suspended", () => {
    expect(() => restoreLease(lease(), t0, 60)).toThrow(/not suspended/);
  });

  test("clears suspended_at and re-derives expires_at from the given clock and duration", () => {
    const record = lease({ suspended_at: t0.toISOString() });
    restoreLease(record, t0, 90);
    expect(record.suspended_at).toBeUndefined();
    expect(record.expires_at).toBe(new Date(t0.valueOf() + 90_000).toISOString());
  });

  test("refreshes heartbeat_at to the restore clock when a heartbeat was already recorded", () => {
    const record = lease({
      suspended_at: t0.toISOString(),
      heartbeat_at: "2020-01-01T00:00:00.000Z",
    });
    restoreLease(record, t0, 60);
    expect(record.heartbeat_at).toBe(t0.toISOString());
  });

  test("leaves heartbeat_at untouched when it was never a string", () => {
    const record = lease({ suspended_at: t0.toISOString() });
    restoreLease(record, t0, 60);
    expect(record.heartbeat_at).toBeUndefined();
  });
});

describe("leaseIsExpired", () => {
  test("never expired while suspended, no matter how stale expires_at looks", () => {
    const record = lease({
      suspended_at: t0.toISOString(),
      expires_at: new Date(t0.valueOf() - 1_000_000).toISOString(),
    });
    expect(leaseIsExpired(record, new Date(t0.valueOf() + 3_600_000))).toBe(false);
  });

  test("not expired when expires_at is missing or not a string", () => {
    expect(leaseIsExpired({}, t0)).toBe(false);
    expect(leaseIsExpired({ expires_at: 12345 }, t0)).toBe(false);
  });

  test("not expired before the deadline plus grace", () => {
    const record = lease({ expires_at: new Date(t0.valueOf() + 5_000).toISOString() });
    expect(leaseIsExpired(record, new Date(t0.valueOf() + 4_000), 0)).toBe(false);
  });

  test("expired once now reaches the deadline plus grace", () => {
    const record = lease({ expires_at: new Date(t0.valueOf() + 5_000).toISOString() });
    expect(leaseIsExpired(record, new Date(t0.valueOf() + 5_000), 0)).toBe(true);
  });

  test("grace extends the deadline", () => {
    const record = lease({ expires_at: new Date(t0.valueOf() + 5_000).toISOString() });
    expect(leaseIsExpired(record, new Date(t0.valueOf() + 6_000), 2_000)).toBe(false);
    expect(leaseIsExpired(record, new Date(t0.valueOf() + 7_000), 2_000)).toBe(true);
  });

  test("not expired when expires_at cannot be parsed into a finite timestamp", () => {
    const record = lease({ expires_at: "not-a-date" });
    expect(leaseIsExpired(record, new Date(t0.valueOf() + 3_600_000))).toBe(false);
  });
});
