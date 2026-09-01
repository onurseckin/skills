import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../../../../olt/scripts/src/cli/execute.ts";
import {
  msgListCommand,
  msgPollCommand,
  msgRecvCommand,
  msgSendCommand,
} from "../../../../../../olt/scripts/src/cli/commands/index.ts";
import { resolveMailboxPaths } from "../../../../../../olt/scripts/src/communication/mailbox/index.ts";

describe("Mailbox IPC CLI Commands - Poll and List", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `msg-cmd-pl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  describe("msg:poll command", () => {
    it("polls until message arrives within interval and timeout", async () => {
      const pollPromise = msgPollCommand({
        actor: "worker-poll",
        interval: "30",
        timeout: "1000",
        "base-dir": testRoot,
      });
      setTimeout(() => {
        msgSendCommand({
          to: "worker-poll",
          type: "HANDOFF_RECEIPT",
          body: "Ready",
          actor: "c",
          role: "coordinator",
          "base-dir": testRoot,
        });
      }, 60);
      const result = await pollPromise;
      expect(result.totalReceipts).toBe(1);
      expect(result.receipts[0]?.message_type).toBe("HANDOFF_RECEIPT");
      expect(result.rounds).toBeGreaterThanOrEqual(1);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(50);
    });

    it("stops polling when max-rounds limit is reached", async () => {
      const result = await msgPollCommand({
        actor: "worker-empty-poll",
        interval: "20",
        "max-rounds": "3",
        timeout: "2000",
        "base-dir": testRoot,
      });
      expect(result.totalReceipts).toBe(0);
      expect(result.rounds).toBe(3);
    });
  });

  describe("msg:list command", () => {
    it("returns empty result when no mailboxes exist", async () => {
      const result = await execute(["msg:list", "--base-dir", testRoot]);
      expect(result.totalMailboxes).toBe(0);
      expect(result.mailboxes).toEqual([]);
      expect(String(result.markdown)).toContain("No mailboxes found");
    });

    it("discovers mailboxes and computes counts, unread, and quarantine", async () => {
      msgSendCommand({
        to: "worker-one",
        type: "DISPATCH_TASK",
        body: "Task 1",
        actor: "coordinator",
        role: "coordinator",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "worker-one",
        type: "DISPATCH_TASK",
        body: "Task 2",
        actor: "coordinator",
        role: "coordinator",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "worker-two",
        type: "PULSE_HEARTBEAT",
        actor: "coordinator",
        role: "coordinator",
        "base-dir": testRoot,
      });

      const pathsOne = resolveMailboxPaths("worker-one", testRoot);
      writeFileSync(pathsOne.quarantinePath, "corrupted line\n");

      await msgRecvCommand({ actor: "worker-one", "base-dir": testRoot });
      msgSendCommand({
        to: "worker-one",
        type: "DISPATCH_TASK",
        body: "Task 3 (unread)",
        actor: "coordinator",
        role: "coordinator",
        "base-dir": testRoot,
      });

      const listResult = msgListCommand({ "base-dir": testRoot });
      expect(listResult.totalMailboxes).toBe(3);
      expect(listResult.markdown).toContain("Mailbox Summaries");
      expect(listResult.markdown).toContain("| `worker-one` |");
      expect(listResult.markdown).toContain("| `worker-two` |");
      expect(listResult.markdown).toContain("| `coordinator` |");

      const workerOneSummary = listResult.mailboxes.find((m) => m.agentId === "worker-one");
      expect(workerOneSummary).toBeDefined();
      if (workerOneSummary !== undefined) {
        expect(workerOneSummary.inboxCount).toBe(3);
        expect(workerOneSummary.unreadCount).toBe(1);
        expect(workerOneSummary.quarantineCount).toBe(1);
        expect(workerOneSummary.lastReadSequence).toBeGreaterThanOrEqual(1);
      }

      const coordSummary = listResult.mailboxes.find((m) => m.agentId === "coordinator");
      expect(coordSummary).toBeDefined();
      if (coordSummary !== undefined) {
        expect(coordSummary.outboxCount).toBe(4);
      }
    });

    it("filters summary by actor flag", () => {
      msgSendCommand({
        to: "worker-alpha",
        type: "DISPATCH_TASK",
        actor: "coordinator",
        role: "coordinator",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "worker-beta",
        type: "DISPATCH_TASK",
        actor: "coordinator",
        role: "coordinator",
        "base-dir": testRoot,
      });

      const single = msgListCommand({ actor: "worker-alpha", "base-dir": testRoot });
      expect(single.totalMailboxes).toBe(1);
      expect(single.mailboxes.length).toBe(1);
      expect(single.mailboxes[0]?.agentId).toBe("worker-alpha");
    });
  });
});
