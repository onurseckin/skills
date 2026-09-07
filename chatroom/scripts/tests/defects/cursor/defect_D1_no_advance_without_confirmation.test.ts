import { describe, expect, it } from "bun:test";
import * as ackModule from "../../../src/cursor/index.ts";
import {
  ChatError,
  computeCursorChecksum,
  type Confirmation,
  type ReaderCursor,
} from "../../../src/cursor/index.ts";

describe("Defect D1: no cursor advance without confirmation", () => {
  it("exports no function that advances cursor without confirmation", () => {
    const exportedKeys = Object.keys(ackModule);
    expect(exportedKeys).toContain("ackLease");

    const candidateAdvanceFns = exportedKeys.filter((key) => {
      const val = (ackModule as Record<string, unknown>)[key];
      return typeof val === "function" && key.toLowerCase().includes("advance");
    });
    expect(candidateAdvanceFns).toHaveLength(0);

    expect(ackModule.ackLease.length).toBeGreaterThanOrEqual(4);
  });

  it("throws INVALID_ARGUMENT when confirmation is absent, null, or incomplete", () => {
    const now = new Date().toISOString();
    const unsigned: Omit<ReaderCursor, "checksum"> = {
      v: 1,
      room: "room-d1",
      reader: "reader-d1",
      contiguous_seq: 0,
      held: [
        {
          lease: "lease-1",
          from: 1,
          to: 3,
          issued_at: now,
          expires_at: new Date(Date.now() + 60000).toISOString(),
          attempt: 1,
        },
      ],
      acked_above: [],
      last_ack_at: null,
      updated_at: now,
    };
    const cursor: ReaderCursor = {
      ...unsigned,
      checksum: computeCursorChecksum(unsigned),
    };

    expect(() =>
      ackModule.ackLease(cursor, "lease-1", 3, undefined as unknown as Confirmation),
    ).toThrow(ChatError);

    expect(() => ackModule.ackLease(cursor, "lease-1", 3, null as unknown as Confirmation)).toThrow(
      ChatError,
    );

    expect(() =>
      ackModule.ackLease(cursor, "lease-1", 3, { kind: "explicit" } as unknown as Confirmation),
    ).toThrow(ChatError);

    expect(() =>
      ackModule.ackLease(cursor, "lease-1", 3, {
        kind: "spooled",
        at: now,
        spool_path: "",
        spool_offset: 10,
        fsynced: true,
      } as unknown as Confirmation),
    ).toThrow(ChatError);

    expect(() =>
      ackModule.ackLease(cursor, "lease-1", 3, {
        kind: "spooled",
        at: now,
        spool_path: "spool.log",
        spool_offset: 10,
      } as unknown as Confirmation),
    ).toThrow(ChatError);
  });

  it("advances contiguous_seq only with valid Confirmation object", () => {
    const now = new Date().toISOString();
    const unsigned: Omit<ReaderCursor, "checksum"> = {
      v: 1,
      room: "room-d1",
      reader: "reader-d1",
      contiguous_seq: 0,
      held: [
        {
          lease: "lease-valid",
          from: 1,
          to: 5,
          issued_at: now,
          expires_at: new Date(Date.now() + 60000).toISOString(),
          attempt: 1,
        },
      ],
      acked_above: [],
      last_ack_at: null,
      updated_at: now,
    };
    const cursor: ReaderCursor = {
      ...unsigned,
      checksum: computeCursorChecksum(unsigned),
    };

    const updated = ackModule.ackLease(cursor, "lease-valid", 5, {
      kind: "explicit",
      at: now,
    });

    expect(updated.contiguous_seq).toBe(5);
    expect(updated.held).toHaveLength(0);
    expect(updated.last_ack_at).toBe(now);
  });
});
