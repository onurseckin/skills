import { describe, expect, it } from "bun:test";
import {
  ackLease,
  ChatError,
  computeCursorChecksum,
  type Confirmation,
  type ReaderCursor,
} from "../../src/cursor/index.ts";

function createTestCursor(
  room: string,
  reader: string,
  now: string,
  leaseId = "lease-1",
  from = 1,
  to = 5,
): ReaderCursor {
  const unsigned: Omit<ReaderCursor, "checksum"> = {
    v: 1,
    room,
    reader,
    contiguous_seq: 0,
    held: [
      {
        lease: leaseId,
        from,
        to,
        issued_at: now,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempt: 1,
      },
    ],
    acked_above: [],
    last_ack_at: null,
    updated_at: now,
  };
  return {
    ...unsigned,
    checksum: computeCursorChecksum(unsigned),
  };
}

describe("cursor ackLease and Confirmation validation", () => {
  it("rejects flushed confirmation when drained is false with INVALID_ARGUMENT", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now);
    const confirmation: Confirmation = {
      kind: "flushed",
      at: now,
      bytes: 1024,
      drained: false,
    };

    try {
      ackLease(cursor, "lease-1", 5, confirmation);
      expect.unreachable();
    } catch (err) {
      expect(err instanceof ChatError).toBe(true);
      const chatErr = err as ChatError;
      expect(chatErr.code).toBe("INVALID_ARGUMENT");
      expect(chatErr.message).toBe("flushed confirmation requires drained: true");
    }
  });

  it("rejects spooled confirmation when fsynced is false with INVALID_ARGUMENT", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now);
    const confirmation: Confirmation = {
      kind: "spooled",
      at: now,
      spool_path: "/spool/reader-1.out.jsonl",
      spool_offset: 2048,
      fsynced: false,
    };

    try {
      ackLease(cursor, "lease-1", 5, confirmation);
      expect.unreachable();
    } catch (err) {
      expect(err instanceof ChatError).toBe(true);
      const chatErr = err as ChatError;
      expect(chatErr.code).toBe("INVALID_ARGUMENT");
      expect(chatErr.message).toBe("spooled confirmation requires fsynced: true");
    }
  });

  it("rejects flushed confirmation when drained is not a boolean", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now);
    const invalidConfirmation = {
      kind: "flushed",
      at: now,
      bytes: 1024,
      drained: "true",
    } as unknown as Confirmation;

    try {
      ackLease(cursor, "lease-1", 5, invalidConfirmation);
      expect.unreachable();
    } catch (err) {
      expect(err instanceof ChatError).toBe(true);
      expect((err as ChatError).code).toBe("INVALID_ARGUMENT");
    }
  });

  it("rejects spooled confirmation when fsynced is not a boolean", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now);
    const invalidConfirmation = {
      kind: "spooled",
      at: now,
      spool_path: "/spool/test",
      spool_offset: 100,
      fsynced: 1,
    } as unknown as Confirmation;

    try {
      ackLease(cursor, "lease-1", 5, invalidConfirmation);
      expect.unreachable();
    } catch (err) {
      expect(err instanceof ChatError).toBe(true);
      expect((err as ChatError).code).toBe("INVALID_ARGUMENT");
    }
  });

  it("succeeds for flushed confirmation when drained is true and advances contiguous_seq", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now);
    const confirmation: Confirmation = {
      kind: "flushed",
      at: now,
      bytes: 1024,
      drained: true,
    };

    const updated = ackLease(cursor, "lease-1", 5, confirmation);
    expect(updated.contiguous_seq).toBe(5);
    expect(updated.held).toHaveLength(0);
    expect(updated.last_ack_at).toBe(now);
  });

  it("succeeds for spooled confirmation when fsynced is true and advances contiguous_seq", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now);
    const confirmation: Confirmation = {
      kind: "spooled",
      at: now,
      spool_path: "/spool/reader-1.out.jsonl",
      spool_offset: 4096,
      fsynced: true,
    };

    const updated = ackLease(cursor, "lease-1", 5, confirmation);
    expect(updated.contiguous_seq).toBe(5);
    expect(updated.held).toHaveLength(0);
    expect(updated.last_ack_at).toBe(now);
  });

  it("succeeds for explicit confirmation and advances contiguous_seq", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now);
    const confirmation: Confirmation = {
      kind: "explicit",
      at: now,
    };

    const updated = ackLease(cursor, "lease-1", 5, confirmation);
    expect(updated.contiguous_seq).toBe(5);
    expect(updated.held).toHaveLength(0);
    expect(updated.last_ack_at).toBe(now);
  });

  it("rejects confirmation when fields are invalid or missing", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now);

    expect(() =>
      ackLease(cursor, "lease-1", 5, null as unknown as Confirmation),
    ).toThrow(ChatError);

    expect(() =>
      ackLease(
        cursor,
        "lease-1",
        5,
        { kind: "unknown", at: now } as unknown as Confirmation,
      ),
    ).toThrow(ChatError);

    expect(() =>
      ackLease(cursor, "lease-1", 5, { kind: "explicit", at: "" }),
    ).toThrow(ChatError);

    expect(() =>
      ackLease(cursor, "lease-1", 5, {
        kind: "flushed",
        at: now,
        bytes: -5,
        drained: true,
      }),
    ).toThrow(ChatError);

    expect(() =>
      ackLease(cursor, "lease-1", 5, {
        kind: "spooled",
        at: now,
        spool_path: "",
        spool_offset: 10,
        fsynced: true,
      }),
    ).toThrow(ChatError);

    expect(() =>
      ackLease(cursor, "lease-1", 5, {
        kind: "spooled",
        at: now,
        spool_path: "/valid/path",
        spool_offset: -1,
        fsynced: true,
      }),
    ).toThrow(ChatError);
  });

  it("supports partial acknowledgment by splitting held lease", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now, "lease-1", 1, 10);
    const confirmation: Confirmation = {
      kind: "explicit",
      at: now,
    };

    const updated = ackLease(cursor, "lease-1", 4, confirmation);
    expect(updated.contiguous_seq).toBe(4);
    expect(updated.held).toHaveLength(1);
    expect(updated.held[0]?.from).toBe(5);
    expect(updated.held[0]?.to).toBe(10);
  });

  it("records out-of-order acks in acked_above and absorbs when gap closes", () => {
    const now = new Date().toISOString();
    const base: Omit<ReaderCursor, "checksum"> = {
      v: 1,
      room: "room-1",
      reader: "reader-1",
      contiguous_seq: 0,
      held: [
        {
          lease: "lease-gap",
          from: 3,
          to: 5,
          issued_at: now,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          attempt: 1,
        },
        {
          lease: "lease-head",
          from: 1,
          to: 2,
          issued_at: now,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          attempt: 1,
        },
      ],
      acked_above: [],
      last_ack_at: null,
      updated_at: now,
    };
    const cursor: ReaderCursor = {
      ...base,
      checksum: computeCursorChecksum(base),
    };

    const confirmation: Confirmation = { kind: "explicit", at: now };
    const step1 = ackLease(cursor, "lease-gap", 5, confirmation);
    expect(step1.contiguous_seq).toBe(0);
    expect(step1.acked_above).toEqual([3, 4, 5]);

    const step2 = ackLease(step1, "lease-head", 2, confirmation);
    expect(step2.contiguous_seq).toBe(5);
    expect(step2.acked_above).toEqual([]);
  });

  it("throws INVALID_STATE when lease is expired or not found", () => {
    const now = new Date().toISOString();
    const expiredCursor: ReaderCursor = {
      v: 1,
      room: "room-1",
      reader: "reader-1",
      contiguous_seq: 0,
      held: [
        {
          lease: "lease-expired",
          from: 1,
          to: 3,
          issued_at: new Date(Date.now() - 120_000).toISOString(),
          expires_at: new Date(Date.now() - 60_000).toISOString(),
          attempt: 1,
        },
      ],
      acked_above: [],
      last_ack_at: null,
      updated_at: now,
      checksum: "",
    };
    const confirmation: Confirmation = { kind: "explicit", at: now };

    try {
      ackLease(expiredCursor, "lease-expired", 3, confirmation);
      expect.unreachable();
    } catch (err) {
      expect(err instanceof ChatError).toBe(true);
      expect((err as ChatError).code).toBe("INVALID_STATE");
    }

    const cursor = createTestCursor("room-1", "reader-1", now);
    try {
      ackLease(cursor, "non-existent-lease", 3, confirmation);
      expect.unreachable();
    } catch (err) {
      expect(err instanceof ChatError).toBe(true);
      expect((err as ChatError).code).toBe("INVALID_STATE");
    }
  });

  it("throws INVALID_STATE when through sequence is out of range", () => {
    const now = new Date().toISOString();
    const cursor = createTestCursor("room-1", "reader-1", now, "lease-1", 5, 10);
    const confirmation: Confirmation = { kind: "explicit", at: now };

    try {
      ackLease(cursor, "lease-1", 4, confirmation);
      expect.unreachable();
    } catch (err) {
      expect(err instanceof ChatError).toBe(true);
      expect((err as ChatError).code).toBe("INVALID_STATE");
    }

    try {
      ackLease(cursor, "lease-1", 11, confirmation);
      expect.unreachable();
    } catch (err) {
      expect(err instanceof ChatError).toBe(true);
      expect((err as ChatError).code).toBe("INVALID_STATE");
    }
  });
});
