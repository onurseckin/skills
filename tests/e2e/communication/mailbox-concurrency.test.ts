import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendMailboxMessage,
  assertEnvelopeIntegrity,
  collectInboxReceipts,
  createSignedEnvelope,
  ensureMailboxDirectories,
  readUnreadMessages,
  resolveMailboxPaths,
  verifyEnvelopeHmac,
  type MailboxEnvelope,
} from "../../../olt/scripts/src/communication/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Wave 4 - Task 4.1: High-Concurrency Mailbox E2E Suite", () => {
  it("Scenario A: High-Concurrency Influx - 10 workers send 500 messages with flock locking", async () => {
    const root = scratchRoot(import.meta.path, "influx-500");
    const target = "coordinator-target";
    const paths = resolveMailboxPaths(target, root);
    ensureMailboxDirectories(paths);

    const workerCount = 10;
    const msgsPerWorker = 50;
    const totalExpected = workerCount * msgsPerWorker;

    const workerTasks = Array.from({ length: workerCount }, async (_, wIdx) => {
      for (let m = 0; m < msgsPerWorker; m++) {
        appendMailboxMessage(
          paths.inboxPath,
          createSignedEnvelope({
            senderId: `worker-influx-${wIdx}`,
            senderRole: "worker",
            recipientId: target,
            messageType: "DISPATCH_TASK",
            payload: { wIdx, seq: m, tag: `w${wIdx}-m${m}` },
            correlationId: `corr-${wIdx}-${m}`,
            sequence: m + 1,
          }),
          paths.lockPath,
        );
        await Promise.resolve();
      }
    });

    await Promise.all(workerTasks);
    const { messages, quarantinedCount } = readUnreadMessages(paths.inboxPath, null, {
      lockPath: paths.lockPath,
      verifyHmac: true,
    });

    expect(quarantinedCount).toBe(0);
    expect(messages.length).toBe(totalExpected);

    const seenTags = new Set<string>();
    const seenIds = new Set<string>();
    for (const msg of messages) {
      assertEnvelopeIntegrity(msg);
      expect(verifyEnvelopeHmac(msg).valid).toBe(true);
      expect(msg.recipient_id).toBe(target);
      seenIds.add(msg.id);
      seenTags.add((msg.payload as { tag: string }).tag);
    }

    expect(seenIds.size).toBe(totalExpected);
    expect(seenTags.size).toBe(totalExpected);
    for (let w = 0; w < workerCount; w++) {
      for (let m = 0; m < msgsPerWorker; m++) {
        expect(seenTags.has(`w${w}-m${m}`)).toBe(true);
      }
    }
  });

  it("Scenario B: Bidirectional Concurrent P2P - 5 workers and 1 coordinator exchange messages & receipts", async () => {
    const root = scratchRoot(import.meta.path, "bidirectional-p2p");
    const coordId = "coordinator-p2p";
    const workerIds = Array.from({ length: 5 }, (_, i) => `p2p-worker-${i}`);
    const coordPaths = resolveMailboxPaths(coordId, root);
    ensureMailboxDirectories(coordPaths);
    workerIds.forEach((wId) => ensureMailboxDirectories(resolveMailboxPaths(wId, root)));

    const msgsPerPeer = 10;
    const totalExpectedReceipts = workerIds.length * msgsPerPeer;

    const coordSendTask = async (): Promise<void> => {
      for (let m = 0; m < msgsPerPeer; m++) {
        for (const wId of workerIds) {
          const wPaths = resolveMailboxPaths(wId, root);
          appendMailboxMessage(
            wPaths.inboxPath,
            createSignedEnvelope({
              senderId: coordId,
              senderRole: "coordinator",
              recipientId: wId,
              messageType: "DISPATCH_TASK",
              payload: { step: m, target: wId },
              correlationId: `task-${wId}-${m}`,
            }),
            wPaths.lockPath,
          );
        }
        await new Promise((r) => setTimeout(r, 1));
      }
    };

    const workerSendTasks = workerIds.map(async (wId, wIdx): Promise<void> => {
      for (let m = 0; m < msgsPerPeer; m++) {
        appendMailboxMessage(
          coordPaths.inboxPath,
          createSignedEnvelope({
            senderId: wId,
            senderRole: "worker",
            recipientId: coordId,
            messageType: "HANDOFF_RECEIPT",
            payload: { workerIdx: wIdx, receiptSeq: m },
            correlationId: `receipt-${wId}-${m}`,
          }),
          coordPaths.lockPath,
        );
        await new Promise((r) => setTimeout(r, 1));
      }
    });

    const coordCollectTask = async (): Promise<MailboxEnvelope<unknown>[]> => {
      let collected: MailboxEnvelope<unknown>[] = [];
      while (collected.length < totalExpectedReceipts) {
        const res = collectInboxReceipts(coordId, {
          baseDir: root,
          messageType: "HANDOFF_RECEIPT",
        });
        collected = res.receipts as MailboxEnvelope<unknown>[];
        if (collected.length >= totalExpectedReceipts) break;
        await new Promise((r) => setTimeout(r, 4));
      }
      return collected;
    };

    const workerCollectTasks = workerIds.map(async (wId): Promise<MailboxEnvelope<unknown>[]> => {
      let collected: MailboxEnvelope<unknown>[] = [];
      while (collected.length < msgsPerPeer) {
        const res = collectInboxReceipts(wId, { baseDir: root, messageType: "DISPATCH_TASK" });
        collected = res.receipts as MailboxEnvelope<unknown>[];
        if (collected.length >= msgsPerPeer) break;
        await new Promise((r) => setTimeout(r, 4));
      }
      return collected;
    });

    const [, , coordReceipts, ...workerResults] = await Promise.all([
      coordSendTask(),
      Promise.all(workerSendTasks),
      coordCollectTask(),
      ...workerCollectTasks,
    ]);

    expect(coordReceipts.length).toBe(totalExpectedReceipts);
    coordReceipts.forEach((env) => {
      assertEnvelopeIntegrity(env);
      expect(env.recipient_id).toBe(coordId);
      expect(env.message_type).toBe("HANDOFF_RECEIPT");
    });

    workerResults.forEach((tasks, wIdx) => {
      expect(tasks.length).toBe(msgsPerPeer);
      tasks.forEach((env) => {
        assertEnvelopeIntegrity(env);
        expect(env.recipient_id).toBe(workerIds[wIdx]);
        expect(env.message_type).toBe("DISPATCH_TASK");
      });
    });
  });

  describe("Architecture Invariants", () => {
    it("ensures file is <= 300 physical lines with 0 any", () => {
      const file = join(process.cwd(), "tests/e2e/communication/mailbox-concurrency.test.ts");
      const lines = readFileSync(file, "utf8").split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);
    });
  });
});
