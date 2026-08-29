import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  msgPollCommand,
  msgRecvCommand,
  msgSendCommand,
} from "../../../olt/scripts/src/cli/commands/index.ts";
import {
  loadMailboxCursor,
  resolveMailboxPaths,
  verifyEnvelopeHmac,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import type { MailboxEnvelope } from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Mailbox IPC CLI Commands", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `msg-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe("msg:send command", () => {
    it("dispatches signed envelope with body and payload via CLI execute", async () => {
      const result = await execute([
        "msg:send",
        "--to",
        "worker-alpha",
        "--type",
        "DISPATCH_TASK",
        "--body",
        "Process chunk #1",
        "--payload",
        '{"chunkId":1,"retries":3}',
        "--actor",
        "coordinator-1",
        "--role",
        "coordinator",
        "--correlation-id",
        "corr-101",
        "--base-dir",
        testRoot,
      ]);

      expect(typeof result.markdown).toBe("string");
      expect(String(result.markdown)).toContain("Mailbox Message Dispatched");
      expect(result.recipient_id).toBe("worker-alpha");
      expect(result.sender_id).toBe("coordinator-1");
      expect(result.sender_role).toBe("coordinator");
      expect(result.message_type).toBe("DISPATCH_TASK");
      expect(result.correlation_id).toBe("corr-101");

      const envelope = result.envelope as MailboxEnvelope<{
        chunkId: number;
        retries: number;
        body: string;
      }>;
      expect(envelope).toBeDefined();
      expect(envelope.payload.chunkId).toBe(1);
      expect(envelope.payload.body).toBe("Process chunk #1");
      expect(verifyEnvelopeHmac(envelope).valid).toBe(true);

      const recipientPaths = resolveMailboxPaths("worker-alpha", testRoot);
      expect(existsSync(recipientPaths.inboxPath)).toBe(true);
      const inboxLines = readFileSync(recipientPaths.inboxPath, "utf8").trim().split("\n");
      expect(inboxLines.length).toBe(1);
    });

    it("handles plain text payload and auto-derives sender when omitted", () => {
      const result = msgSendCommand({
        to: "worker-beta",
        type: "PULSE_HEARTBEAT",
        payload: "non-json-payload",
        "base-dir": testRoot,
      });

      expect(result.envelope.recipient_id).toBe("worker-beta");
      expect(result.envelope.payload).toEqual({ text: "non-json-payload" });
      expect(typeof result.envelope.sender_id).toBe("string");
      expect(typeof result.envelope.sender_role).toBe("string");
      expect(verifyEnvelopeHmac(result.envelope).valid).toBe(true);
    });

    it("fails closed when required flags are missing", () => {
      expect(() =>
        msgSendCommand({
          type: "DISPATCH_TASK",
          "base-dir": testRoot,
        }),
      ).toThrow(HarnessError);

      expect(() =>
        msgSendCommand({
          to: "worker-alpha",
          "base-dir": testRoot,
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("msg:recv command", () => {
    it("receives unread messages and advances cursor by default", async () => {
      msgSendCommand({
        to: "worker-rcv",
        type: "DISPATCH_TASK",
        body: "First message",
        actor: "coord-1",
        role: "coordinator",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "worker-rcv",
        type: "PULSE_HEARTBEAT",
        body: "Second message",
        actor: "coord-1",
        role: "coordinator",
        "base-dir": testRoot,
      });

      const recv1 = await execute(["msg:recv", "--actor", "worker-rcv", "--base-dir", testRoot]);

      expect(recv1.totalReceipts).toBe(2);
      expect((recv1.receipts as MailboxEnvelope[]).length).toBe(2);

      const paths = resolveMailboxPaths("worker-rcv", testRoot);
      const cursor = loadMailboxCursor(paths.cursorPath);
      expect(cursor.seen_ids.length).toBe(2);
      expect(cursor.last_read_sequence).toBeGreaterThanOrEqual(1);

      const recv2 = await execute(["msg:recv", "--actor", "worker-rcv", "--base-dir", testRoot]);
      expect(recv2.totalReceipts).toBe(0);
    });

    it("preserves cursor when no-advance-cursor is specified", async () => {
      msgSendCommand({
        to: "worker-no-adv",
        type: "DISPATCH_TASK",
        body: "Stay unread",
        actor: "coord-1",
        role: "coordinator",
        "base-dir": testRoot,
      });

      const recv = await msgRecvCommand({
        actor: "worker-no-adv",
        "no-advance-cursor": true,
        "base-dir": testRoot,
      });

      expect(recv.totalReceipts).toBe(1);

      const recvAgain = await msgRecvCommand({
        actor: "worker-no-adv",
        "no-advance-cursor": true,
        "base-dir": testRoot,
      });
      expect(recvAgain.totalReceipts).toBe(1);
    });

    it("filters messages by type and correlation-id", async () => {
      msgSendCommand({
        to: "worker-filt",
        type: "DISPATCH_TASK",
        actor: "coord-1",
        role: "coordinator",
        "correlation-id": "task-42",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "worker-filt",
        type: "PULSE_HEARTBEAT",
        actor: "coord-1",
        role: "coordinator",
        "correlation-id": "heartbeat-99",
        "base-dir": testRoot,
      });

      const filtered = await msgRecvCommand({
        actor: "worker-filt",
        type: "DISPATCH_TASK",
        "correlation-id": "task-42",
        "base-dir": testRoot,
      });

      expect(filtered.totalReceipts).toBe(1);
      const first = filtered.receipts[0];
      expect(first).toBeDefined();
      if (first !== undefined) {
        expect(first.message_type).toBe("DISPATCH_TASK");
        expect(first.correlation_id).toBe("task-42");
      }
    });

    it("waits for incoming message when wait flag is set and times out when none arrive", async () => {
      const waitPromise = msgRecvCommand({
        actor: "worker-wait",
        wait: true,
        timeout: 400,
        "base-dir": testRoot,
      });

      setTimeout(() => {
        msgSendCommand({
          to: "worker-wait",
          type: "DISPATCH_TASK",
          body: "Delayed message",
          actor: "coord-1",
          role: "coordinator",
          "base-dir": testRoot,
        });
      }, 50);

      const recv = await waitPromise;
      expect(recv.totalReceipts).toBe(1);
      const first = recv.receipts[0];
      expect(first).toBeDefined();
      if (first !== undefined) {
        expect(first.payload).toEqual({ body: "Delayed message" });
      }

      const timeoutResult = await msgRecvCommand({
        actor: "worker-timeout",
        wait: true,
        timeout: 100,
        "base-dir": testRoot,
      });
      expect(timeoutResult.totalReceipts).toBe(0);
    });
  });

  describe("msg:poll command", () => {
    it("polls until message arrives within interval and timeout", async () => {
      const pollPromise = msgPollCommand({
        actor: "worker-poll",
        interval: 30,
        timeout: 1000,
        "base-dir": testRoot,
      });

      setTimeout(() => {
        msgSendCommand({
          to: "worker-poll",
          type: "HANDOFF_RECEIPT",
          body: "Ready to work",
          actor: "coord-1",
          role: "coordinator",
          "base-dir": testRoot,
        });
      }, 60);

      const result = await pollPromise;
      expect(result.totalReceipts).toBe(1);
      const first = result.receipts[0];
      expect(first).toBeDefined();
      if (first !== undefined) {
        expect(first.message_type).toBe("HANDOFF_RECEIPT");
      }
      expect(result.rounds).toBeGreaterThanOrEqual(1);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(50);
    });

    it("stops polling when max-rounds limit is reached", async () => {
      const result = await msgPollCommand({
        actor: "worker-empty-poll",
        interval: 20,
        "max-rounds": 3,
        timeout: 2000,
        "base-dir": testRoot,
      });

      expect(result.totalReceipts).toBe(0);
      expect(result.rounds).toBe(3);
    });
  });
});
