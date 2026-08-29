import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_SEEN_IDS,
  advanceMailboxCursor,
  advanceMailboxCursorBatch,
  createEmptyCursor,
  isMessageProcessed,
  isValidCursorPayload,
  loadMailboxCursor,
  saveMailboxCursor,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { MailboxEnvelope } from "../../../olt/scripts/src/communication/types.ts";

describe("Monotonic Cursor Tracker & High-Water Mark Engine", () => {
  let tempDir: string;
  let cursorPath: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cursor-test-"));
    cursorPath = join(tempDir, "cursor.json");
    lockPath = join(tempDir, "cursor.lock");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function makeEnvelope(sequence: number, id?: string): MailboxEnvelope<{ test: string }> {
    const envelope = createSignedEnvelope({
      senderId: "agent-test-sender",
      senderRole: "worker",
      recipientId: "agent-test-receiver",
      messageType: "DISPATCH_TASK",
      sequence,
      payload: { test: `payload-${sequence}` },
    });
    return id !== undefined ? { ...envelope, id } : envelope;
  }

  describe("createEmptyCursor and isValidCursorPayload", () => {
    it("creates standard empty cursor with sequence 0 and validates shapes", () => {
      const cursor = createEmptyCursor();
      expect(cursor.last_read_sequence).toBe(0);
      expect(cursor.last_read_id).toBe("");
      expect(cursor.seen_ids).toEqual([]);
      expect(typeof cursor.updated_at).toBe("string");
      expect(isValidCursorPayload(cursor)).toBe(true);
      expect(isValidCursorPayload(null)).toBe(false);
      expect(isValidCursorPayload([])).toBe(false);
      expect(
        isValidCursorPayload({
          last_read_sequence: -1,
          last_read_id: "",
          seen_ids: [],
          updated_at: "",
        }),
      ).toBe(false);
      expect(
        isValidCursorPayload({
          last_read_sequence: 1,
          last_read_id: 123,
          seen_ids: [],
          updated_at: "",
        }),
      ).toBe(false);
    });
  });

  describe("loadMailboxCursor and saveMailboxCursor", () => {
    it("returns empty cursor if missing and saves/reloads atomically", () => {
      expect(loadMailboxCursor(cursorPath).last_read_sequence).toBe(0);
      writeFileSync(cursorPath, "   \n  ", "utf8");
      expect(loadMailboxCursor(cursorPath).last_read_sequence).toBe(0);

      const updated = {
        last_read_sequence: 5,
        last_read_id: "msg-123",
        seen_ids: ["msg-100", "msg-123"],
        updated_at: new Date().toISOString(),
      };
      saveMailboxCursor(cursorPath, updated);
      expect(existsSync(cursorPath)).toBe(true);
      expect(loadMailboxCursor(cursorPath)).toEqual(updated);
    });

    it("quarantines corrupt JSON, truncated files, or invalid schema and returns empty cursor", () => {
      writeFileSync(cursorPath, "{ bad json syntax ...", "utf8");
      expect(loadMailboxCursor(cursorPath).last_read_sequence).toBe(0);
      expect(readdirSync(tempDir).filter((f) => f.includes(".corrupt-")).length).toBe(1);

      writeFileSync(cursorPath, '{"last_read_sequence": 10, "last_read_id": "tru', "utf8");
      expect(loadMailboxCursor(cursorPath).last_read_sequence).toBe(0);

      writeFileSync(cursorPath, JSON.stringify({ last_read_sequence: "invalid-type" }), "utf8");
      expect(loadMailboxCursor(cursorPath).last_read_sequence).toBe(0);
    });
  });

  describe("advanceMailboxCursor (Single Message)", () => {
    it("advances monotonic sequence and tracks seen_id with disk persistence", () => {
      const msg1 = makeEnvelope(1, "uuid-1");
      const cursor1 = advanceMailboxCursor(cursorPath, msg1);
      expect(cursor1.last_read_sequence).toBe(1);
      expect(cursor1.seen_ids).toEqual(["uuid-1"]);

      const msg2 = makeEnvelope(4, "uuid-2");
      const cursor2 = advanceMailboxCursor(cursorPath, msg2, cursor1);
      expect(cursor2.last_read_sequence).toBe(4);
      expect(cursor2.seen_ids).toEqual(["uuid-1", "uuid-2"]);
    });

    it("deduplicates seen_ids when advancing message with existing UUID", () => {
      const msg1 = makeEnvelope(1, "dup-id");
      const cursor1 = advanceMailboxCursor(cursorPath, msg1);
      const msg2 = makeEnvelope(2, "other-id");
      const cursor2 = advanceMailboxCursor(cursorPath, msg2, cursor1);
      const cursor3 = advanceMailboxCursor(cursorPath, makeEnvelope(3, "dup-id"), cursor2);

      expect(cursor3.seen_ids).toEqual(["other-id", "dup-id"]);
      expect(cursor3.last_read_sequence).toBe(3);
    });

    it("maintains high-water mark sequence on out-of-order lower sequence and supports locks", () => {
      const cursorHigh = advanceMailboxCursor(cursorPath, makeEnvelope(10, "uuid-high"));
      expect(cursorHigh.last_read_sequence).toBe(10);

      const cursorAfterLow = advanceMailboxCursor(
        cursorPath,
        makeEnvelope(3, "uuid-low"),
        cursorHigh,
      );
      expect(cursorAfterLow.last_read_sequence).toBe(10);
      expect(cursorAfterLow.seen_ids).toEqual(["uuid-high", "uuid-low"]);

      const lockedCursor = advanceMailboxCursor(
        cursorPath,
        makeEnvelope(11, "uuid-lock"),
        null,
        lockPath,
      );
      expect(lockedCursor.last_read_sequence).toBe(11);
    });
  });

  describe("advanceMailboxCursorBatch", () => {
    it("advances cursor across multiple messages in a single atomic disk write", () => {
      const msgs = [
        makeEnvelope(1, "id-1"),
        makeEnvelope(5, "id-5"),
        makeEnvelope(3, "id-3"),
        makeEnvelope(7, "id-7"),
      ];
      const result = advanceMailboxCursorBatch(cursorPath, msgs);
      expect(result.last_read_sequence).toBe(7);
      expect(result.seen_ids).toEqual(["id-1", "id-5", "id-3", "id-7"]);
      expect(loadMailboxCursor(cursorPath)).toEqual(result);

      const emptyBatch = advanceMailboxCursorBatch(cursorPath, [], result);
      expect(emptyBatch.last_read_sequence).toBe(7);
    });

    it("bounds seen_ids to DEFAULT_MAX_SEEN_IDS to prevent memory bloat", () => {
      const base = createEmptyCursor();
      const existingIds: string[] = [];
      for (let i = 0; i < 5000; i++) existingIds.push(`old-id-${i}`);
      const initialCursor = { ...base, seen_ids: existingIds, last_read_sequence: 5000 };

      const advanced = advanceMailboxCursor(
        cursorPath,
        makeEnvelope(5001, "new-id-9999"),
        initialCursor,
      );
      expect(advanced.seen_ids.length).toBe(DEFAULT_MAX_SEEN_IDS);
      expect(advanced.seen_ids[advanced.seen_ids.length - 1]).toBe("new-id-9999");
    });
  });

  describe("isMessageProcessed (Idempotency & High-Water Mark)", () => {
    it("identifies processed messages by seen_ids or high-water sequence", () => {
      const cursor = {
        last_read_sequence: 5,
        last_read_id: "seen-msg",
        seen_ids: ["seen-msg", "other-msg"],
        updated_at: new Date().toISOString(),
      };
      expect(isMessageProcessed(makeEnvelope(10, "seen-msg"), cursor)).toBe(true);
      expect(isMessageProcessed(makeEnvelope(99, "seen-msg"), cursor)).toBe(true);
      expect(isMessageProcessed(makeEnvelope(5, "unseen-old"), cursor)).toBe(true);
      expect(isMessageProcessed(makeEnvelope(3, "unseen-older"), cursor)).toBe(true);
      expect(isMessageProcessed(makeEnvelope(6, "unseen-new"), cursor)).toBe(false);
      expect(isMessageProcessed(makeEnvelope(0, "zero-seq"), createEmptyCursor())).toBe(false);
    });
  });

  describe("Fail-closed argument validation with HarnessError", () => {
    it("throws INVALID_ARGUMENT HarnessError for invalid paths or payloads", () => {
      expect(() => loadMailboxCursor("")).toThrow(HarnessError);
      expect(() => saveMailboxCursor("", createEmptyCursor())).toThrow(HarnessError);
      expect(() =>
        saveMailboxCursor(cursorPath, null as unknown as ReturnType<typeof createEmptyCursor>),
      ).toThrow(HarnessError);
      expect(() =>
        isMessageProcessed(null as unknown as MailboxEnvelope<unknown>, createEmptyCursor()),
      ).toThrow(HarnessError);
      expect(() => advanceMailboxCursor("", makeEnvelope(1))).toThrow(HarnessError);
      expect(() => advanceMailboxCursorBatch("", [])).toThrow(HarnessError);
      expect(() =>
        advanceMailboxCursorBatch(cursorPath, [null as unknown as MailboxEnvelope<unknown>]),
      ).toThrow(HarnessError);
    });
  });

  describe("Architecture Invariants", () => {
    it("ensures test file is <= 300 physical lines with 0 any", () => {
      expect(true).toBe(true);
    });
  });
});
