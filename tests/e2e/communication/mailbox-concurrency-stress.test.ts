import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  advanceMailboxCursorBatch,
  assertEnvelopeIntegrity,
  createEmptyCursor,
  createSignedEnvelope,
  escapeQuarantinePayload,
  isMessageProcessed,
  isValidEnvelopeStructure,
  verifyEnvelopeHmac,
  type MailboxCursor,
  type MailboxEnvelope,
} from "../../../olt/scripts/src/communication/index.ts";

class InMemoryStressMailbox {
  private rawLines: string[] = [];
  private readonly quarantineLog: string[] = [];
  private locked = false;
  private readonly waiters: (() => void)[] = [];

  async withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    while (this.locked) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.locked = true;
    try {
      return await operation();
    } finally {
      this.locked = false;
      const next = this.waiters.shift();
      if (next) next();
    }
  }

  async appendRaw(line: string): Promise<void> {
    await this.withLock(async () => {
      this.rawLines.push(line);
      await Promise.resolve();
    });
  }

  async appendEnvelope(envelope: MailboxEnvelope<unknown>): Promise<void> {
    await this.appendRaw(JSON.stringify(envelope));
  }

  async readUnread(
    cursor: MailboxCursor | null,
    options?: { verifyHmac?: boolean; enableQuarantine?: boolean },
  ): Promise<{ messages: MailboxEnvelope<unknown>[]; quarantinedCount: number }> {
    return await this.withLock(async () => {
      const validEnvelopes: MailboxEnvelope<unknown>[] = [];
      const quarantined: { line: string; reason: string }[] = [];

      for (const line of this.rawLines) {
        if (line.trim().length === 0) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          if (options?.enableQuarantine) {
            quarantined.push({ line, reason: "MALFORMED_JSON_SYNTAX" });
            continue;
          }
          throw new Error("MALFORMED_JSON_SYNTAX");
        }

        if (!isValidEnvelopeStructure(parsed)) {
          if (options?.enableQuarantine) {
            quarantined.push({ line, reason: "INVALID_ENVELOPE_STRUCTURE" });
            continue;
          }
          throw new Error("INVALID_ENVELOPE_STRUCTURE");
        }

        if (options?.verifyHmac) {
          const verification = verifyEnvelopeHmac(parsed);
          if (!verification.valid) {
            if (options?.enableQuarantine) {
              quarantined.push({
                line,
                reason: `HMAC_VERIFICATION_FAILED: ${verification.error ?? "invalid signature"}`,
              });
              continue;
            }
            throw new Error("HMAC_VERIFICATION_FAILED");
          }
        }

        validEnvelopes.push(parsed);
      }

      if (quarantined.length > 0 && options?.enableQuarantine) {
        const ts = new Date().toISOString();
        for (const item of quarantined) {
          this.quarantineLog.push(
            `[${ts}] [REASON: ${item.reason}] ${escapeQuarantinePayload(item.line)}`,
          );
        }
        this.rawLines = validEnvelopes.map((env) => JSON.stringify(env));
      }

      const effectiveCursor = cursor ?? createEmptyCursor();
      const unread = validEnvelopes.filter((env) => !isMessageProcessed(env, effectiveCursor));
      return { messages: unread, quarantinedCount: quarantined.length };
    });
  }

  getQuarantineLog(): string {
    return this.quarantineLog.join("\n");
  }

  getRawLines(): string[] {
    return [...this.rawLines];
  }
}

describe("Wave 4 - Concurrency Stress & Quarantine Resilience (In-Memory)", () => {
  it("Scenario C: Concurrent Read/Write with Cursor Tracking - exact-once processing", async () => {
    const mailbox = new InMemoryStressMailbox();
    const agentId = "cursor-stream-agent";
    const totalMessages = 100;
    let producerDone = false;

    const producerTask = async (): Promise<void> => {
      for (let seq = 1; seq <= totalMessages; seq++) {
        const envelope = createSignedEnvelope({
          senderId: "producer-worker",
          senderRole: "worker",
          recipientId: agentId,
          messageType: "STATUS_UPDATE",
          payload: { itemSeq: seq },
          sequence: seq,
        });
        await mailbox.appendEnvelope(envelope);
        if (seq % 5 === 0) await Promise.resolve();
      }
      producerDone = true;
    };

    const consumerTask = async (): Promise<MailboxEnvelope<unknown>[]> => {
      const consumed: MailboxEnvelope<unknown>[] = [];
      let cursor: MailboxCursor = createEmptyCursor();

      while (!producerDone || consumed.length < totalMessages) {
        const { messages, quarantinedCount } = await mailbox.readUnread(cursor, {
          verifyHmac: true,
        });
        expect(quarantinedCount).toBe(0);
        if (messages.length > 0) {
          cursor = advanceMailboxCursorBatch("memory-cursor", messages, cursor);
          consumed.push(...messages);
        }
        await Promise.resolve();
      }
      return consumed;
    };

    const [, consumedMessages] = await Promise.all([producerTask(), consumerTask()]);

    expect(consumedMessages.length).toBe(totalMessages);
    expect(consumedMessages.map((m) => m.sequence)).toEqual(
      Array.from({ length: totalMessages }, (_, i) => i + 1),
    );
    expect(new Set(consumedMessages.map((m) => m.id)).size).toBe(totalMessages);

    const finalCheck = await mailbox.readUnread(
      advanceMailboxCursorBatch("memory-cursor", consumedMessages, createEmptyCursor()),
    );
    expect(finalCheck.messages.length).toBe(0);
  });

  it("Scenario D: Quarantine Integrity Under Contention - cleanly strips torn/tampered lines", async () => {
    const mailbox = new InMemoryStressMailbox();
    const targetAgent = "quarantine-target";
    const validCount = 60;
    const injectedTorn = 10;

    const validPublisherTask = async (): Promise<void> => {
      for (let i = 0; i < validCount; i++) {
        const envelope = createSignedEnvelope({
          senderId: "valid-worker",
          senderRole: "worker",
          recipientId: targetAgent,
          messageType: "STATUS_UPDATE",
          payload: { validIdx: i },
          correlationId: `valid-${i}`,
          sequence: i + 1,
        });
        await mailbox.appendEnvelope(envelope);
        if (i % 6 === 0) await Promise.resolve();
      }
    };

    const faultInjectorTask = async (): Promise<void> => {
      for (let j = 0; j < injectedTorn; j++) {
        const tornChunk = `{"id":"torn-${j}","sequence":${9000 + j},"corrupt_fragment`;
        const tampered = {
          ...createSignedEnvelope({
            senderId: "bad-actor",
            senderRole: "worker",
            recipientId: targetAgent,
            messageType: "STATUS_UPDATE",
            payload: { secret: "compromised" },
            sequence: 8000 + j,
          }),
          hmac_signature: "00112233445566778899aabbccddeeff00112233",
        };
        await mailbox.appendRaw(tornChunk);
        await mailbox.appendRaw(JSON.stringify(tampered));
        await Promise.resolve();
      }
    };

    const readerTask = async (): Promise<void> => {
      let cursor: MailboxCursor = createEmptyCursor();
      for (let check = 0; check < 15; check++) {
        const { messages } = await mailbox.readUnread(cursor, {
          enableQuarantine: true,
          verifyHmac: true,
        });
        if (messages.length > 0) {
          cursor = advanceMailboxCursorBatch("memory-cursor", messages, cursor);
        }
        await Promise.resolve();
      }
    };

    await Promise.all([validPublisherTask(), faultInjectorTask(), readerTask()]);

    const finalSweep = await mailbox.readUnread(null, {
      enableQuarantine: true,
      verifyHmac: true,
    });

    const quarantineLog = mailbox.getQuarantineLog();
    expect(quarantineLog).toContain("MALFORMED_JSON_SYNTAX");
    expect(quarantineLog).toContain("HMAC_VERIFICATION_FAILED");

    expect(finalSweep.messages.length).toBe(validCount);
    for (const msg of finalSweep.messages) {
      assertEnvelopeIntegrity(msg);
      expect(verifyEnvelopeHmac(msg).valid).toBe(true);
    }

    const finalInboxLines = mailbox.getRawLines();
    expect(finalInboxLines.length).toBe(validCount);
    for (const line of finalInboxLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  describe("Architecture Invariants", () => {
    it("ensures file is <= 300 physical lines with 0 any", () => {
      const file = join(
        process.cwd(),
        "tests/e2e/communication/mailbox-concurrency-stress.test.ts",
      );
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);
      expect(content).not.toMatch(/:\s*any\b/);
      expect(content).not.toMatch(/\/\/\s*@ts-(ignore|expect-error)/);
    });
  });
});
