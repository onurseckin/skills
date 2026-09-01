import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_SEEN_IDS,
  advanceMailboxCursor,
  advanceMailboxCursorBatch,
  clearInMemoryCursors,
  createEmptyCursor,
  getInMemoryCursor,
  loadMailboxCursor,
  saveMailboxCursor,
  setInMemoryCursor,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type {
  MailboxCursor,
  MailboxEnvelope,
} from "../../../olt/scripts/src/communication/types.ts";

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

describe("Cursor Tracker Persistence & Advancement", () => {
  let tempDir: string;
  let cursorPath: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cursor-persistence-test-"));
    cursorPath = join(tempDir, "cursor.json");
    lockPath = join(tempDir, "cursor.lock");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
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

      saveMailboxCursor(cursorPath, updated, lockPath);
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

    it("throws INTEGRITY error when cursor directory creation fails or rename fails", () => {
      const blockingFile = join(tempDir, "blocker");
      writeFileSync(blockingFile, "file", "utf8");
      const badPath = join(blockingFile, "child", "cursor.json");
      expect(() => saveMailboxCursor(badPath, createEmptyCursor())).toThrow(HarnessError);

      const dirAsCursorPath = join(tempDir, "dir-cursor-path");
      mkdirSync(dirAsCursorPath);
      expect(() => saveMailboxCursor(dirAsCursorPath, createEmptyCursor())).toThrow(HarnessError);
    });

    it("throws INTEGRITY error when reading cursor from unreadable path or directory", () => {
      const dirAsCursor = join(tempDir, "dir-as-cursor");
      mkdirSync(dirAsCursor);
      expect(() => loadMailboxCursor(dirAsCursor)).toThrow(HarnessError);
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

      const lockedBatch = advanceMailboxCursorBatch(
        cursorPath,
        [makeEnvelope(8, "id-8")],
        result,
        lockPath,
      );
      expect(lockedBatch.last_read_sequence).toBe(8);
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

  describe("Fail-closed argument validation with HarnessError", () => {
    it("throws INVALID_ARGUMENT HarnessError for invalid paths or payloads", () => {
      expect(() => loadMailboxCursor("")).toThrow(HarnessError);
      expect(() => loadMailboxCursor(123 as unknown as string)).toThrow(HarnessError);
      expect(() => saveMailboxCursor("", createEmptyCursor())).toThrow(HarnessError);
      expect(() =>
        saveMailboxCursor(cursorPath, null as unknown as ReturnType<typeof createEmptyCursor>),
      ).toThrow(HarnessError);
      expect(() =>
        saveMailboxCursor(cursorPath, { bad: "payload" } as unknown as MailboxCursor),
      ).toThrow(HarnessError);

      expect(() => advanceMailboxCursor("", makeEnvelope(1))).toThrow(HarnessError);
      expect(() =>
        advanceMailboxCursor(cursorPath, { id: 123 } as unknown as MailboxEnvelope<unknown>),
      ).toThrow(HarnessError);
      expect(() =>
        advanceMailboxCursor(cursorPath, makeEnvelope(1), {
          bad: true,
        } as unknown as MailboxCursor),
      ).toThrow(HarnessError);

      expect(() => advanceMailboxCursorBatch("", [])).toThrow(HarnessError);
      expect(() =>
        advanceMailboxCursorBatch(
          cursorPath,
          "not-array" as unknown as readonly MailboxEnvelope<unknown>[],
        ),
      ).toThrow(HarnessError);
      expect(() =>
        advanceMailboxCursorBatch(cursorPath, [null as unknown as MailboxEnvelope<unknown>]),
      ).toThrow(HarnessError);
      expect(() =>
        advanceMailboxCursorBatch(cursorPath, [{ id: 123 } as unknown as MailboxEnvelope<unknown>]),
      ).toThrow(HarnessError);
      expect(() =>
        advanceMailboxCursorBatch(cursorPath, [], { bad: true } as unknown as MailboxCursor),
      ).toThrow(HarnessError);
    });

    it("operates seamlessly in in-memory mode with setInMemoryCursor and virtual paths", () => {
      const vPath = "virtual://cursor-suite/.olt/mailboxes/agent-1/cursor.json";
      const cur = {
        last_read_sequence: 42,
        last_read_id: "id-42",
        seen_ids: ["id-42"],
        updated_at: new Date().toISOString(),
      };
      setInMemoryCursor(vPath, cur);
      expect(getInMemoryCursor(vPath)).toEqual(cur);
      expect(loadMailboxCursor(vPath)).toEqual(cur);

      const advanced = advanceMailboxCursor(vPath, makeEnvelope(43, "id-43"), cur);
      expect(advanced.last_read_sequence).toBe(43);
      expect(loadMailboxCursor(vPath).last_read_sequence).toBe(43);

      saveMailboxCursor(vPath, { ...cur, last_read_sequence: 99 });
      expect(loadMailboxCursor(vPath).last_read_sequence).toBe(99);

      clearInMemoryCursors();
      expect(loadMailboxCursor(vPath).last_read_sequence).toBe(0);
    });
  });
});
