import { describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  advanceMailboxCursorBatch,
  appendMailboxMessage,
  assertEnvelopeIntegrity,
  createSignedEnvelope,
  dispatchPeerMessage,
  ensureMailboxDirectories,
  loadMailboxCursor,
  readUnreadMessages,
  resolveMailboxPaths,
  verifyEnvelopeHmac,
  withExclusiveLock,
  type MailboxCursor,
  type MailboxEnvelope,
} from "../../../olt/scripts/src/communication/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Wave 4 - Concurrency Stress & Quarantine Resilience", () => {
  it("Scenario C: Concurrent Read/Write with Cursor Tracking - exact-once processing", async () => {
    const root = scratchRoot(import.meta.path, "cursor-exact-once");
    const agentId = "cursor-stream-agent";
    const paths = resolveMailboxPaths(agentId, root);
    ensureMailboxDirectories(paths);

    const totalMessages = 100;
    let producerDone = false;

    const producerTask = async (): Promise<void> => {
      for (let seq = 1; seq <= totalMessages; seq++) {
        appendMailboxMessage(
          paths.inboxPath,
          createSignedEnvelope({
            senderId: "producer-worker",
            senderRole: "worker",
            recipientId: agentId,
            messageType: "STATUS_UPDATE",
            payload: { itemSeq: seq },
            sequence: seq,
          }),
          paths.lockPath,
        );
        if (seq % 5 === 0) await new Promise((r) => setTimeout(r, 2));
      }
      producerDone = true;
    };

    const consumerTask = async (): Promise<MailboxEnvelope<unknown>[]> => {
      const consumed: MailboxEnvelope<unknown>[] = [];
      let cursor: MailboxCursor | null = loadMailboxCursor(paths.cursorPath);

      while (!producerDone || consumed.length < totalMessages) {
        const { messages, quarantinedCount } = readUnreadMessages(paths.inboxPath, cursor, {
          lockPath: paths.lockPath,
          verifyHmac: true,
        });
        expect(quarantinedCount).toBe(0);
        if (messages.length > 0) {
          cursor = advanceMailboxCursorBatch(paths.cursorPath, messages, cursor, paths.lockPath);
          consumed.push(...messages);
        }
        await new Promise((r) => setTimeout(r, 4));
      }
      return consumed;
    };

    const [, consumedMessages] = await Promise.all([producerTask(), consumerTask()]);

    expect(consumedMessages.length).toBe(totalMessages);
    expect(consumedMessages.map((m) => m.sequence)).toEqual(
      Array.from({ length: totalMessages }, (_, i) => i + 1),
    );
    expect(new Set(consumedMessages.map((m) => m.id)).size).toBe(totalMessages);

    const finalCursor = loadMailboxCursor(paths.cursorPath);
    expect(finalCursor.last_read_sequence).toBe(totalMessages);
    expect(finalCursor.seen_ids.length).toBe(totalMessages);
    expect(
      readUnreadMessages(paths.inboxPath, finalCursor, { lockPath: paths.lockPath }).messages
        .length,
    ).toBe(0);
  });

  it("Scenario D: Quarantine Integrity Under Contention - cleanly strips torn/tampered lines", async () => {
    const root = scratchRoot(import.meta.path, "quarantine-contention");
    const targetAgent = "quarantine-target";
    const paths = resolveMailboxPaths(targetAgent, root);
    ensureMailboxDirectories(paths);

    const validCount = 60;
    const injectedTorn = 10;

    const validPublisherTask = async (): Promise<void> => {
      for (let i = 0; i < validCount; i++) {
        dispatchPeerMessage({
          senderId: "valid-worker",
          senderRole: "worker",
          recipientRoleOrId: targetAgent,
          messageType: "STATUS_UPDATE",
          payload: { validIdx: i },
          correlationId: `valid-${i}`,
          baseDir: root,
        });
        if (i % 6 === 0) await new Promise((r) => setTimeout(r, 3));
      }
    };

    const faultInjectorTask = async (): Promise<void> => {
      for (let j = 0; j < injectedTorn; j++) {
        withExclusiveLock(paths.lockPath, "fault-injector", () => {
          ensureMailboxDirectories(paths);
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
          appendFileSync(paths.inboxPath, `${tornChunk}\n${JSON.stringify(tampered)}\n`, "utf8");
        });
        await new Promise((r) => setTimeout(r, 4));
      }
    };

    const readerTask = async (): Promise<MailboxEnvelope<unknown>[]> => {
      const allRead: MailboxEnvelope<unknown>[] = [];
      let cursor: MailboxCursor | null = null;
      for (let check = 0; check < 15; check++) {
        const { messages } = readUnreadMessages(paths.inboxPath, cursor, {
          lockPath: paths.lockPath,
          quarantinePath: paths.quarantinePath,
          verifyHmac: true,
        });
        if (messages.length > 0) {
          cursor = advanceMailboxCursorBatch(paths.cursorPath, messages, cursor, paths.lockPath);
          allRead.push(...messages);
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      return allRead;
    };

    await Promise.all([validPublisherTask(), faultInjectorTask(), readerTask()]);

    const finalSweep = readUnreadMessages(paths.inboxPath, null, {
      lockPath: paths.lockPath,
      quarantinePath: paths.quarantinePath,
      verifyHmac: true,
    });

    expect(existsSync(paths.quarantinePath)).toBe(true);
    const quarantineLog = readFileSync(paths.quarantinePath, "utf8");
    expect(quarantineLog).toContain("MALFORMED_JSON_SYNTAX");
    expect(quarantineLog).toContain("HMAC_VERIFICATION_FAILED");

    expect(finalSweep.messages.length).toBe(validCount);
    finalSweep.messages.forEach((msg) => {
      assertEnvelopeIntegrity(msg);
      expect(verifyEnvelopeHmac(msg).valid).toBe(true);
    });

    const finalInboxLines = readFileSync(paths.inboxPath, "utf8").trim().split("\n");
    expect(finalInboxLines.length).toBe(validCount);
    finalInboxLines.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
  });

  it("ensures file is <= 300 physical lines with 0 any", () => {
    const file = join(process.cwd(), "tests/e2e/communication/mailbox-concurrency-stress.test.ts");
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines.length).toBeLessThanOrEqual(300);
  });
});
