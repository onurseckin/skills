import { describe, expect, it } from "bun:test";
import {
  ackLease,
  computeCursorChecksum,
  createInitialCursor,
  leaseNext,
  type Confirmation,
  type HeldLease,
  type LogEnvelope,
  type ReaderCursor,
} from "../../src/cursor/index.ts";

function makeEnvelope(room: string, seq: number): LogEnvelope {
  return {
    v: 1,
    id: `msg-${seq}`,
    room,
    seq,
    ts: new Date(1700000000000 + seq * 1000).toISOString(),
    sender: {
      id: "agent-test",
      role: "tester",
      host: "virtual",
    },
    kind: "chat",
    text: `Message ${seq}`,
    key_fingerprint: "fp-virtual",
    sig: `sig-${seq}`,
  };
}

function makeEnvelopes(room: string, count: number): readonly LogEnvelope[] {
  const envelopes: LogEnvelope[] = [];
  for (let i = 1; i <= count; i++) {
    envelopes.push(makeEnvelope(room, i));
  }
  return envelopes;
}

function createCursorWithState(
  room: string,
  reader: string,
  contiguousSeq: number,
  ackedAbove: readonly number[],
  held: readonly HeldLease[] = [],
  now = "2026-09-07T12:00:00.000Z",
): ReaderCursor {
  const unsigned: Omit<ReaderCursor, "checksum"> = {
    v: 1,
    room,
    reader,
    contiguous_seq: contiguousSeq,
    held: [...held],
    acked_above: [...ackedAbove],
    last_ack_at: null,
    last_ack_kind: null,
    updated_at: now,
  };
  return {
    ...unsigned,
    checksum: computeCursorChecksum(unsigned),
  };
}

describe("leaseNext acked_above boundary enforcement", () => {
  it("bounds batch to avoid spanning into acked_above", () => {
    const room = "room-test-1";
    const reader = "reader-test-1";
    const log = makeEnvelopes(room, 10);
    const cursor = createCursorWithState(room, reader, 0, [3, 4, 5]);

    const result = leaseNext(cursor, log, 10);

    expect(result.leaseId).not.toBeNull();
    expect(result.messages.length).toBe(2);
    expect(result.messages[0]?.seq).toBe(1);
    expect(result.messages[1]?.seq).toBe(2);
    expect(result.cursor.held.length).toBe(1);
    expect(result.cursor.held[0]?.from).toBe(1);
    expect(result.cursor.held[0]?.to).toBe(2);
    expect(result.cursor.acked_above).toEqual([3, 4, 5]);
    expect(result.cursor.contiguous_seq).toBe(0);
  });

  it("reproduces out-of-order ack scenario and re-leases without CURSOR_CORRUPT", () => {
    const room = "room-test-2";
    const reader = "reader-test-2";
    const log = makeEnvelopes(room, 10);
    const initialTime = "2026-09-07T12:00:00.000Z";

    let cursor = createInitialCursor(room, reader, initialTime);

    const lease1 = leaseNext(cursor, log, 2, { now: initialTime, ttlMs: 1000 });
    cursor = lease1.cursor;
    expect(lease1.messages.map((m) => m.seq)).toEqual([1, 2]);

    const lease2 = leaseNext(cursor, log, 3, { now: initialTime, ttlMs: 60000 });
    cursor = lease2.cursor;
    expect(lease2.messages.map((m) => m.seq)).toEqual([3, 4, 5]);

    const confirmation: Confirmation = { kind: "explicit", at: "2026-09-07T12:00:01.000Z" };
    cursor = ackLease(cursor, lease2.leaseId!, null, confirmation);
    expect(cursor.contiguous_seq).toBe(0);
    expect(cursor.acked_above).toEqual([3, 4, 5]);
    expect(cursor.held.length).toBe(1);

    const expiredTime = "2026-09-07T12:00:10.000Z";
    const lease3 = leaseNext(cursor, log, 10, { now: expiredTime });
    expect(lease3.leaseId).not.toBeNull();
    expect(lease3.messages.length).toBe(2);
    expect(lease3.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(lease3.cursor.held.length).toBe(1);
    expect(lease3.cursor.held[0]?.from).toBe(1);
    expect(lease3.cursor.held[0]?.to).toBe(2);
    expect(lease3.cursor.acked_above).toEqual([3, 4, 5]);
  });

  it("progresses multi-step by advancing contiguous_seq and leasing beyond absorbed acked_above", () => {
    const room = "room-test-3";
    const reader = "reader-test-3";
    const log = makeEnvelopes(room, 10);
    const t0 = "2026-09-07T12:00:00.000Z";

    let cursor = createInitialCursor(room, reader, t0);

    const lease1 = leaseNext(cursor, log, 2, { now: t0, ttlMs: 1000 });
    cursor = lease1.cursor;

    const lease2 = leaseNext(cursor, log, 3, { now: t0, ttlMs: 60000 });
    cursor = lease2.cursor;

    const conf1: Confirmation = { kind: "explicit", at: "2026-09-07T12:00:01.000Z" };
    cursor = ackLease(cursor, lease2.leaseId!, null, conf1);

    const tExpired = "2026-09-07T12:00:10.000Z";
    const lease3 = leaseNext(cursor, log, 10, { now: tExpired });
    cursor = lease3.cursor;

    const conf2: Confirmation = { kind: "explicit", at: "2026-09-07T12:00:11.000Z" };
    cursor = ackLease(cursor, lease3.leaseId!, null, conf2);

    expect(cursor.contiguous_seq).toBe(5);
    expect(cursor.acked_above).toEqual([]);
    expect(cursor.held).toEqual([]);

    const lease4 = leaseNext(cursor, log, 10, { now: "2026-09-07T12:00:12.000Z" });
    expect(lease4.messages.map((m) => m.seq)).toEqual([6, 7, 8, 9, 10]);
    expect(lease4.cursor.held.length).toBe(1);
    expect(lease4.cursor.held[0]?.from).toBe(6);
    expect(lease4.cursor.held[0]?.to).toBe(10);
  });

  it("skips leading acked_above when startSeq advances past active held and acked sequences", () => {
    const room = "room-test-4";
    const reader = "reader-test-4";
    const log = makeEnvelopes(room, 10);
    const now = "2026-09-07T12:00:00.000Z";
    const activeHeld: HeldLease = {
      lease: "held-active-1",
      from: 1,
      to: 2,
      issued_at: now,
      expires_at: "2026-09-07T13:00:00.000Z",
      attempt: 1,
    };

    const cursor = createCursorWithState(room, reader, 0, [3, 4, 5], [activeHeld], now);

    const result = leaseNext(cursor, log, 10, { now });

    expect(result.leaseId).not.toBeNull();
    expect(result.messages.map((m) => m.seq)).toEqual([6, 7, 8, 9, 10]);
    expect(result.cursor.held.length).toBe(2);
    expect(result.cursor.held[0]?.from).toBe(1);
    expect(result.cursor.held[0]?.to).toBe(2);
    expect(result.cursor.held[1]?.from).toBe(6);
    expect(result.cursor.held[1]?.to).toBe(10);
    expect(result.cursor.acked_above).toEqual([3, 4, 5]);
  });

  it("handles interleaved active held and acked_above ranges cleanly", () => {
    const room = "room-test-5";
    const reader = "reader-test-5";
    const log = makeEnvelopes(room, 10);
    const now = "2026-09-07T12:00:00.000Z";
    const held1: HeldLease = {
      lease: "held-1",
      from: 1,
      to: 2,
      issued_at: now,
      expires_at: "2026-09-07T13:00:00.000Z",
      attempt: 1,
    };
    const held2: HeldLease = {
      lease: "held-2",
      from: 5,
      to: 6,
      issued_at: now,
      expires_at: "2026-09-07T13:00:00.000Z",
      attempt: 1,
    };

    const cursor = createCursorWithState(room, reader, 0, [3, 4, 7, 8], [held1, held2], now);

    const result = leaseNext(cursor, log, 10, { now });

    expect(result.leaseId).not.toBeNull();
    expect(result.messages.map((m) => m.seq)).toEqual([9, 10]);
    expect(result.cursor.held.length).toBe(3);
    expect(result.cursor.held[0]?.from).toBe(1);
    expect(result.cursor.held[0]?.to).toBe(2);
    expect(result.cursor.held[1]?.from).toBe(5);
    expect(result.cursor.held[1]?.to).toBe(6);
    expect(result.cursor.held[2]?.from).toBe(9);
    expect(result.cursor.held[2]?.to).toBe(10);
    expect(result.cursor.acked_above).toEqual([3, 4, 7, 8]);
  });
});
