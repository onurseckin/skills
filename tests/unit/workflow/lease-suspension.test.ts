import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  isLeaseSuspended,
  leaseIsExpired,
  restoreLease,
  suspendLease,
} from "../../../olt/scripts/src/workflow/lease/suspension.ts";

class FakeClock {
  private ms: number;
  public constructor(start: string | Date = "2026-08-19T00:00:00.000Z") {
    this.ms = new Date(start).getTime();
  }
  public now(): Date {
    return new Date(this.ms);
  }
  public tick(deltaMs = 1_000): Date {
    this.ms += deltaMs;
    return this.now();
  }
  public iso(): string {
    return this.now().toISOString();
  }
}

function lease(clock: FakeClock, overrides: JsonObject = {}): JsonObject {
  return {
    expires_at: new Date(clock.now().valueOf() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("isLeaseSuspended", () => {
  test("false when suspended_at is absent", () => {
    const clock = new FakeClock();
    expect(isLeaseSuspended(lease(clock))).toBe(false);
  });

  test("false when suspended_at is present but not a string", () => {
    const clock = new FakeClock();
    expect(isLeaseSuspended(lease(clock, { suspended_at: 1 }))).toBe(false);
  });

  test("true when suspended_at is a string", () => {
    const clock = new FakeClock();
    expect(isLeaseSuspended(lease(clock, { suspended_at: clock.iso() }))).toBe(true);
  });
});

describe("suspendLease", () => {
  test("stamps suspended_at with the given clock as an ISO string", () => {
    const clock = new FakeClock();
    const record = lease(clock);
    suspendLease(record, clock.now());
    expect(record.suspended_at).toBe(clock.iso());
  });

  test("refuses to suspend a lease that is already suspended", () => {
    const clock = new FakeClock();
    const record = lease(clock, { suspended_at: clock.iso() });
    expect(() => suspendLease(record, clock.now())).toThrow(/already suspended/);
  });
});

describe("restoreLease", () => {
  test("refuses to restore a lease that was never suspended", () => {
    const clock = new FakeClock();
    expect(() => restoreLease(lease(clock), clock.now(), 60)).toThrow(/not suspended/);
  });

  test("clears suspended_at and re-derives expires_at from the given clock and duration", () => {
    const clock = new FakeClock();
    const record = lease(clock, { suspended_at: clock.iso() });
    clock.tick(10_000);
    restoreLease(record, clock.now(), 90);
    expect(record.suspended_at).toBeUndefined();
    expect(record.expires_at).toBe(new Date(clock.now().valueOf() + 90_000).toISOString());
  });

  test("refreshes heartbeat_at to the restore clock when a heartbeat was already recorded", () => {
    const clock = new FakeClock();
    const record = lease(clock, {
      suspended_at: clock.iso(),
      heartbeat_at: "2020-01-01T00:00:00.000Z",
    });
    clock.tick(5_000);
    restoreLease(record, clock.now(), 60);
    expect(record.heartbeat_at).toBe(clock.iso());
  });

  test("leaves heartbeat_at untouched when it was never a string", () => {
    const clock = new FakeClock();
    const record = lease(clock, { suspended_at: clock.iso() });
    restoreLease(record, clock.now(), 60);
    expect(record.heartbeat_at).toBeUndefined();
  });
});

describe("leaseIsExpired", () => {
  test("never expired while suspended, no matter how stale expires_at looks", () => {
    const clock = new FakeClock();
    const record = lease(clock, {
      suspended_at: clock.iso(),
      expires_at: new Date(clock.now().valueOf() - 1_000_000).toISOString(),
    });
    clock.tick(3_600_000);
    expect(leaseIsExpired(record, clock.now())).toBe(false);
  });

  test("not expired when expires_at is missing or not a string", () => {
    const clock = new FakeClock();
    expect(leaseIsExpired({}, clock.now())).toBe(false);
    expect(leaseIsExpired({ expires_at: 12345 }, clock.now())).toBe(false);
  });

  test("not expired before the deadline plus grace", () => {
    const clock = new FakeClock();
    const record = lease(clock, {
      expires_at: new Date(clock.now().valueOf() + 5_000).toISOString(),
    });
    clock.tick(4_000);
    expect(leaseIsExpired(record, clock.now(), 0)).toBe(false);
  });

  test("expired once now reaches the deadline plus grace", () => {
    const clock = new FakeClock();
    const record = lease(clock, {
      expires_at: new Date(clock.now().valueOf() + 5_000).toISOString(),
    });
    clock.tick(5_000);
    expect(leaseIsExpired(record, clock.now(), 0)).toBe(true);
  });

  test("grace extends the deadline", () => {
    const clock = new FakeClock();
    const record = lease(clock, {
      expires_at: new Date(clock.now().valueOf() + 5_000).toISOString(),
    });
    clock.tick(6_000);
    expect(leaseIsExpired(record, clock.now(), 2_000)).toBe(false);
    clock.tick(1_000);
    expect(leaseIsExpired(record, clock.now(), 2_000)).toBe(true);
  });

  test("not expired when expires_at cannot be parsed into a finite timestamp", () => {
    const clock = new FakeClock();
    const record = lease(clock, { expires_at: "not-a-date" });
    clock.tick(3_600_000);
    expect(leaseIsExpired(record, clock.now())).toBe(false);
  });
});
