import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  msgListCommand,
  msgPollCommand,
  msgRecvCommand,
  msgSendCommand,
} from "../../../../../../olt/scripts/src/cli/commands/index.ts";
import { execute } from "../../../../../../olt/scripts/src/cli/execute.ts";
import { resolveMailboxPaths } from "../../../../../../olt/scripts/src/communication/mailbox/index.ts";
import type { MailboxEnvelope } from "../../../../../../olt/scripts/src/communication/types.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../../fixtures/full-lifecycle-fixture.ts";

describe("Mailbox CLI Operations - Polling and Listing Workflows", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCliFS();
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `msg-ops-p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualCliFS();
  });

  describe("msg:poll operations", () => {
    it("polls and resolves when messages arrive asynchronously", async () => {
      const pollPromise = execute([
        "msg:poll",
        "--actor",
        "poll-receiver",
        "--interval",
        "25",
        "--timeout",
        "1500",
        "--base-dir",
        testRoot,
      ]);

      setTimeout(() => {
        msgSendCommand({
          to: "poll-receiver",
          type: "HANDOFF_RECEIPT",
          body: "Handoff ready",
          actor: "worker-sender",
          "base-dir": testRoot,
        });
      }, 50);

      const res = await pollPromise;
      expect(res.totalReceipts).toBe(1);
      const receipts = res.receipts as readonly MailboxEnvelope[];
      expect(receipts[0]?.message_type).toBe("HANDOFF_RECEIPT");
      expect(Number(res.rounds)).toBeGreaterThanOrEqual(1);
      expect(Number(res.elapsedMs)).toBeGreaterThanOrEqual(40);
    });

    it("terminates when polling timeout expires without messages", async () => {
      const res = await msgPollCommand({
        actor: "nobody",
        interval: "20",
        timeout: "80",
        "base-dir": testRoot,
      });
      expect(res.totalReceipts).toBe(0);
      expect(res.receipts.length).toBe(0);
      expect(res.elapsedMs).toBeGreaterThanOrEqual(70);
    });

    it("terminates when max-rounds count is reached", async () => {
      const res = await msgPollCommand({
        actor: "nobody-max-rounds",
        interval: "15",
        "max-rounds": "3",
        timeout: "5000",
        "base-dir": testRoot,
      });
      expect(res.totalReceipts).toBe(0);
      expect(res.rounds).toBe(3);
    });

    it("supports no-advance-cursor in msg:poll", async () => {
      msgSendCommand({
        to: "poll-noadv",
        type: "DIRECTIVE",
        body: "Instruction",
        actor: "lead",
        "base-dir": testRoot,
      });
      const poll1 = await msgPollCommand({
        actor: "poll-noadv",
        "no-advance-cursor": true,
        "base-dir": testRoot,
      });
      expect(poll1.totalReceipts).toBe(1);
      const poll2 = await msgPollCommand({ actor: "poll-noadv", "base-dir": testRoot });
      expect(poll2.totalReceipts).toBe(1);
      const poll3 = await msgPollCommand({
        actor: "poll-noadv",
        timeout: "50",
        "base-dir": testRoot,
      });
      expect(poll3.totalReceipts).toBe(0);
    });
  });

  describe("msg:list operations", () => {
    it("reports zero mailboxes when directory is empty", async () => {
      const res = await execute(["msg:list", "--base-dir", testRoot]);
      expect(res.totalMailboxes).toBe(0);
      expect(String(res.markdown)).toContain("No mailboxes found");
    });

    it("aggregates inbox, unread, outbox, and quarantine counts across agents", async () => {
      msgSendCommand({
        to: "agent-1",
        type: "DISPATCH_TASK",
        body: "A",
        actor: "sender-root",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "agent-1",
        type: "DISPATCH_TASK",
        body: "B",
        actor: "sender-root",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "agent-2",
        type: "PULSE_HEARTBEAT",
        actor: "sender-root",
        "base-dir": testRoot,
      });

      const paths1 = resolveMailboxPaths("agent-1", testRoot);
      writeFileSync(paths1.quarantinePath, "corrupted-line\n");
      await msgRecvCommand({ actor: "agent-1", "base-dir": testRoot });

      msgSendCommand({
        to: "agent-1",
        type: "DISPATCH_TASK",
        body: "C",
        actor: "sender-root",
        "base-dir": testRoot,
      });

      const listRes = msgListCommand({ "base-dir": testRoot });
      expect(listRes.totalMailboxes).toBe(3);
      expect(listRes.markdown).toContain("Mailbox Summaries");
      expect(listRes.markdown).toContain("`agent-1`");
      expect(listRes.markdown).toContain("`agent-2`");
      expect(listRes.markdown).toContain("`sender-root`");

      const a1Summary = listRes.mailboxes.find((m) => m.agentId === "agent-1");
      expect(a1Summary).toBeDefined();
      if (a1Summary !== undefined) {
        expect(a1Summary.inboxCount).toBe(3);
        expect(a1Summary.unreadCount).toBe(1);
        expect(a1Summary.quarantineCount).toBe(1);
        expect(a1Summary.lastReadSequence).toBeGreaterThanOrEqual(1);
      }

      const senderSummary = listRes.mailboxes.find((m) => m.agentId === "sender-root");
      expect(senderSummary).toBeDefined();
      if (senderSummary !== undefined) {
        expect(senderSummary.outboxCount).toBe(4);
      }
    });

    it("filters list summary by actor flag", () => {
      msgSendCommand({
        to: "worker-x",
        type: "DISPATCH_TASK",
        actor: "boss",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "worker-y",
        type: "DISPATCH_TASK",
        actor: "boss",
        "base-dir": testRoot,
      });
      const single = msgListCommand({ actor: "worker-x", "base-dir": testRoot });
      expect(single.totalMailboxes).toBe(1);
      expect(single.mailboxes[0]?.agentId).toBe("worker-x");
    });
  });
});
