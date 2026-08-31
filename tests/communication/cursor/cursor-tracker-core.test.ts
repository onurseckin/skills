import { describe, expect, it } from "bun:test";
import {
  createEmptyCursor,
  isMessageProcessed,
  isValidCursorPayload,
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

describe("Cursor Tracker Core Shapes & Idempotency", () => {
  describe("createEmptyCursor and isValidCursorPayload", () => {
    it("creates standard empty cursor with sequence 0 and validates shapes", () => {
      const cursor = createEmptyCursor();
      expect(cursor.last_read_sequence).toBe(0);
      expect(cursor.last_read_id).toBe("");
      expect(cursor.seen_ids).toEqual([]);
      expect(typeof cursor.updated_at).toBe("string");
      expect(isValidCursorPayload(cursor)).toBe(true);
      expect(isValidCursorPayload(null)).toBe(false);
      expect(isValidCursorPayload(undefined)).toBe(false);
      expect(isValidCursorPayload([])).toBe(false);
      expect(isValidCursorPayload("string")).toBe(false);
      expect(isValidCursorPayload(123)).toBe(false);
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
          last_read_sequence: Number.NaN,
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
      expect(
        isValidCursorPayload({
          last_read_sequence: 1,
          last_read_id: "id",
          seen_ids: "not-an-array",
          updated_at: "",
        }),
      ).toBe(false);
      expect(
        isValidCursorPayload({
          last_read_sequence: 1,
          last_read_id: "id",
          seen_ids: [123],
          updated_at: "",
        }),
      ).toBe(false);
      expect(
        isValidCursorPayload({
          last_read_sequence: 1,
          last_read_id: "id",
          seen_ids: ["id-1"],
          updated_at: 12345,
        }),
      ).toBe(false);
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
    it("throws INVALID_ARGUMENT HarnessError for invalid payloads and messages", () => {
      expect(() =>
        isMessageProcessed(null as unknown as MailboxEnvelope<unknown>, createEmptyCursor()),
      ).toThrow(HarnessError);
      expect(() =>
        isMessageProcessed({ id: 123 } as unknown as MailboxEnvelope<unknown>, createEmptyCursor()),
      ).toThrow(HarnessError);
      expect(() =>
        isMessageProcessed(makeEnvelope(1), { invalid: true } as unknown as MailboxCursor),
      ).toThrow(HarnessError);
    });
  });
});
