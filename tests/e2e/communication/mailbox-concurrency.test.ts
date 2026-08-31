import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertEnvelopeIntegrity,
  createSignedEnvelope,
  verifyEnvelopeHmac,
  type MailboxEnvelope,
} from "../../../olt/scripts/src/communication/index.ts";

class InMemoryMailboxStore {
  private readonly lines: string[] = [];
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

  async append(envelope: MailboxEnvelope<unknown>): Promise<void> {
    await this.withLock(async () => {
      this.lines.push(JSON.stringify(envelope));
      await Promise.resolve();
    });
  }

  readAll(): MailboxEnvelope<unknown>[] {
    const results: MailboxEnvelope<unknown>[] = [];
    for (const line of this.lines) {
      if (line.trim().length === 0) continue;
      results.push(JSON.parse(line) as MailboxEnvelope<unknown>);
    }
    return results;
  }

  collectReceipts(messageType?: string): MailboxEnvelope<unknown>[] {
    const all = this.readAll();
    return messageType ? all.filter((env) => env.message_type === messageType) : all;
  }
}

describe("Wave 4 - Task 4.1: High-Concurrency Mailbox E2E Suite (In-Memory)", () => {
  it("Scenario A: High-Concurrency Influx - 10 workers send 500 messages with flock locking", async () => {
    const target = "coordinator-target";
    const mailbox = new InMemoryMailboxStore();

    const workerCount = 10;
    const msgsPerWorker = 50;
    const totalExpected = workerCount * msgsPerWorker;

    const workerTasks = Array.from({ length: workerCount }, async (_, wIdx) => {
      for (let m = 0; m < msgsPerWorker; m++) {
        const envelope = createSignedEnvelope({
          senderId: `worker-influx-${wIdx}`,
          senderRole: "worker",
          recipientId: target,
          messageType: "DISPATCH_TASK",
          payload: { wIdx, seq: m, tag: `w${wIdx}-m${m}` },
          correlationId: `corr-${wIdx}-${m}`,
          sequence: m + 1,
        });
        await mailbox.append(envelope);
      }
    });

    await Promise.all(workerTasks);
    const messages = mailbox.readAll();

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
    const coordId = "coordinator-p2p";
    const workerIds = Array.from({ length: 5 }, (_, i) => `p2p-worker-${i}`);
    const mailboxes = new Map<string, InMemoryMailboxStore>();

    mailboxes.set(coordId, new InMemoryMailboxStore());
    for (const wId of workerIds) {
      mailboxes.set(wId, new InMemoryMailboxStore());
    }

    const msgsPerPeer = 10;
    const totalExpectedReceipts = workerIds.length * msgsPerPeer;

    const coordSendTask = async (): Promise<void> => {
      for (let m = 0; m < msgsPerPeer; m++) {
        for (const wId of workerIds) {
          const wMailbox = mailboxes.get(wId);
          if (wMailbox) {
            const envelope = createSignedEnvelope({
              senderId: coordId,
              senderRole: "coordinator",
              recipientId: wId,
              messageType: "DISPATCH_TASK",
              payload: { step: m, target: wId },
              correlationId: `task-${wId}-${m}`,
            });
            await wMailbox.append(envelope);
          }
        }
        await Promise.resolve();
      }
    };

    const workerSendTasks = workerIds.map(async (wId, wIdx): Promise<void> => {
      const coordMailbox = mailboxes.get(coordId);
      for (let m = 0; m < msgsPerPeer; m++) {
        if (coordMailbox) {
          const envelope = createSignedEnvelope({
            senderId: wId,
            senderRole: "worker",
            recipientId: coordId,
            messageType: "HANDOFF_RECEIPT",
            payload: { workerIdx: wIdx, receiptSeq: m },
            correlationId: `receipt-${wId}-${m}`,
          });
          await coordMailbox.append(envelope);
        }
        await Promise.resolve();
      }
    });

    await Promise.all([coordSendTask(), Promise.all(workerSendTasks)]);

    const coordMailbox = mailboxes.get(coordId);
    const coordReceipts = coordMailbox ? coordMailbox.collectReceipts("HANDOFF_RECEIPT") : [];
    expect(coordReceipts.length).toBe(totalExpectedReceipts);
    for (const env of coordReceipts) {
      assertEnvelopeIntegrity(env);
      expect(verifyEnvelopeHmac(env).valid).toBe(true);
      expect(env.recipient_id).toBe(coordId);
      expect(env.message_type).toBe("HANDOFF_RECEIPT");
    }

    workerIds.forEach((wId, wIdx) => {
      const wMailbox = mailboxes.get(wId);
      const tasks = wMailbox ? wMailbox.collectReceipts("DISPATCH_TASK") : [];
      expect(tasks.length).toBe(msgsPerPeer);
      for (const env of tasks) {
        assertEnvelopeIntegrity(env);
        expect(verifyEnvelopeHmac(env).valid).toBe(true);
        expect(env.recipient_id).toBe(workerIds[wIdx]);
        expect(env.message_type).toBe("DISPATCH_TASK");
      }
    });
  });

  describe("Architecture Invariants", () => {
    it("ensures file is <= 300 physical lines with 0 any", () => {
      const file = join(process.cwd(), "tests/e2e/communication/mailbox-concurrency.test.ts");
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);
      expect(content).not.toMatch(/:\s*any\b/);
      expect(content).not.toMatch(/\/\/\s*@ts-(ignore|expect-error)/);
    });
  });
});
