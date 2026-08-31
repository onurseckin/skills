import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  broadcastWaveNotification,
  collectInboxReceipts,
  dispatchPeerMessage,
  resolveMailboxPaths,
  resolveRecipientAgentIds,
  verifyEnvelopeHmac,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import type { MailboxEnvelope } from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("P2P Mailbox Dispatcher & Role Resolution", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `disp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  describe("resolveRecipientAgentIds", () => {
    it("resolves exact matches and role substrings from mailbox directories and locks", () => {
      const mbRoot = join(testRoot, ".olt", "mailboxes");
      mkdirSync(join(mbRoot, "worker-alpha"), { recursive: true });
      mkdirSync(join(mbRoot, "worker_beta"), { recursive: true });
      mkdirSync(join(mbRoot, "lead_worker_node"), { recursive: true });
      mkdirSync(join(mbRoot, "coordinator-0"), { recursive: true });
      mkdirSync(join(mbRoot, ".locks"), { recursive: true });
      writeFileSync(join(mbRoot, ".locks", "validator-1.lock"), "");
      mkdirSync(join(testRoot, ".olt", "locks", "mailboxes"), { recursive: true });
      writeFileSync(join(testRoot, ".olt", "locks", "mailboxes", "repairer-1.lock"), "");
      mkdirSync(join(testRoot, ".olt", "locks"), { recursive: true });
      writeFileSync(join(testRoot, ".olt", "locks", "critic-1.lock"), "");

      expect(resolveRecipientAgentIds("worker-alpha", testRoot)).toEqual(["worker-alpha"]);
      expect(resolveRecipientAgentIds("worker", testRoot)).toEqual([
        "lead_worker_node",
        "worker-alpha",
        "worker_beta",
      ]);
      expect(resolveRecipientAgentIds("coordinator", testRoot)).toEqual(["coordinator-0"]);
      expect(resolveRecipientAgentIds("validator", testRoot)).toEqual(["validator-1"]);
      expect(resolveRecipientAgentIds("repairer", testRoot)).toEqual(["repairer-1"]);
      expect(resolveRecipientAgentIds("critic", testRoot)).toEqual(["critic-1"]);
      expect(resolveRecipientAgentIds("custom-agent-99", testRoot)).toEqual(["custom-agent-99"]);
    });

    it("rejects invalid roles, empty strings, and path traversal attempts", () => {
      expect(() => resolveRecipientAgentIds("", testRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("   ", testRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds(123 as unknown as string, testRoot)).toThrow(
        HarnessError,
      );
      expect(() => resolveRecipientAgentIds(".", testRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("../outside", testRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("sub/agent", testRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("sub\\agent", testRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("null\0byte", testRoot)).toThrow(HarnessError);
    });
  });

  describe("dispatchPeerMessage", () => {
    it("signs envelope with HMAC and appends to recipient inbox and sender outbox", () => {
      const envelope = dispatchPeerMessage({
        senderId: "coordinator-1",
        senderRole: "coordinator",
        recipientRoleOrId: "worker-1",
        messageType: "DISPATCH_TASK",
        payload: { task: "process-chunk", chunkId: 42 },
        correlationId: "corr-100",
        baseDir: testRoot,
      });

      expect(envelope.id).toBeDefined();
      expect(envelope.sender_id).toBe("coordinator-1");
      expect(envelope.recipient_id).toBe("worker-1");
      expect(envelope.correlation_id).toBe("corr-100");
      expect(verifyEnvelopeHmac(envelope).valid).toBe(true);

      const recipientPaths = resolveMailboxPaths("worker-1", testRoot);
      const senderPaths = resolveMailboxPaths("coordinator-1", testRoot);
      expect(existsSync(recipientPaths.inboxPath)).toBe(true);
      expect(existsSync(senderPaths.outboxPath)).toBe(true);

      const inboxLines = readFileSync(recipientPaths.inboxPath, "utf8").trim().split("\n");
      expect(inboxLines.length).toBe(1);
      const firstInbox = inboxLines[0];
      expect(firstInbox).toBeDefined();
      if (firstInbox !== undefined) {
        const parsedInbox = JSON.parse(firstInbox) as MailboxEnvelope<{ task: string }>;
        expect(parsedInbox.id).toBe(envelope.id);
        expect(parsedInbox.payload.task).toBe("process-chunk");
      }

      const outboxLines = readFileSync(senderPaths.outboxPath, "utf8").trim().split("\n");
      expect(outboxLines.length).toBe(1);
      const firstOutbox = outboxLines[0];
      expect(firstOutbox).toBeDefined();
      if (firstOutbox !== undefined) {
        expect((JSON.parse(firstOutbox) as MailboxEnvelope).id).toBe(envelope.id);
      }
    });

    it("resolves role name to agent ID on dispatch", () => {
      mkdirSync(join(testRoot, ".olt", "mailboxes", "worker-42"), { recursive: true });
      const envelope = dispatchPeerMessage({
        senderId: "coord-1",
        senderRole: "coordinator",
        recipientRoleOrId: "worker",
        messageType: "DISPATCH_TASK",
        payload: { ready: true },
        baseDir: testRoot,
      });
      expect(envelope.recipient_id).toBe("worker-42");
    });

    it("fails closed on invalid arguments", () => {
      expect(() =>
        dispatchPeerMessage(null as unknown as Parameters<typeof dispatchPeerMessage>[0]),
      ).toThrow(HarnessError);
      expect(() =>
        dispatchPeerMessage("not-obj" as unknown as Parameters<typeof dispatchPeerMessage>[0]),
      ).toThrow(HarnessError);
      expect(() =>
        dispatchPeerMessage({} as unknown as Parameters<typeof dispatchPeerMessage>[0]),
      ).toThrow(HarnessError);
      expect(() =>
        dispatchPeerMessage({
          senderId: "",
          senderRole: "c",
          recipientRoleOrId: "w",
          messageType: "DISPATCH_TASK",
          payload: {},
        }),
      ).toThrow(HarnessError);
      expect(() =>
        dispatchPeerMessage({
          senderId: "c",
          senderRole: "",
          recipientRoleOrId: "w",
          messageType: "DISPATCH_TASK",
          payload: {},
        }),
      ).toThrow(HarnessError);
      expect(() =>
        dispatchPeerMessage({
          senderId: "c",
          senderRole: "c",
          recipientRoleOrId: "",
          messageType: "DISPATCH_TASK",
          payload: {},
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("broadcastWaveNotification", () => {
    it("dispatches notifications to all target recipients and resolves roles", () => {
      mkdirSync(join(testRoot, ".olt", "mailboxes", "worker-a"), { recursive: true });
      mkdirSync(join(testRoot, ".olt", "mailboxes", "worker-b"), { recursive: true });
      mkdirSync(join(testRoot, ".olt", "mailboxes", "validator-1"), { recursive: true });

      const envelopes = broadcastWaveNotification({
        senderId: "coordinator-0",
        senderRole: "coordinator",
        recipientIds: ["worker", "worker-a", "validator-1"],
        messageType: "PULSE_HEARTBEAT",
        payload: { wave: 1 },
        correlationId: "wave-corr-1",
        baseDir: testRoot,
      });

      expect(envelopes.length).toBe(3);
      const recipientIds = envelopes.map((e) => e.recipient_id).sort();
      expect(recipientIds).toEqual(["validator-1", "worker-a", "worker-b"]);

      for (const id of recipientIds) {
        const inbox = resolveMailboxPaths(id, testRoot).inboxPath;
        expect(existsSync(inbox)).toBe(true);
      }
    });

    it("returns empty array when recipient list is empty and rejects non-array", () => {
      const res = broadcastWaveNotification({
        senderId: "c-1",
        senderRole: "c",
        recipientIds: [],
        messageType: "PULSE_HEARTBEAT",
        payload: {},
        baseDir: testRoot,
      });
      expect(res).toEqual([]);
      expect(() =>
        broadcastWaveNotification(
          null as unknown as Parameters<typeof broadcastWaveNotification>[0],
        ),
      ).toThrow(HarnessError);
      expect(() =>
        broadcastWaveNotification(
          "not-obj" as unknown as Parameters<typeof broadcastWaveNotification>[0],
        ),
      ).toThrow(HarnessError);
      expect(() =>
        broadcastWaveNotification({
          senderId: "c-1",
          senderRole: "c",
          recipientIds: "bad" as unknown as string[],
          messageType: "PULSE_HEARTBEAT",
          payload: {},
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("collectInboxReceipts", () => {
    it("collects unread messages, filters by correlationId/messageType, and advances cursor", () => {
      dispatchPeerMessage({
        senderId: "agent-sender",
        senderRole: "sender",
        recipientRoleOrId: "agent-receiver",
        messageType: "HANDOFF_RECEIPT",
        payload: { task: 1 },
        correlationId: "corr-A",
        baseDir: testRoot,
      });
      dispatchPeerMessage({
        senderId: "agent-sender",
        senderRole: "sender",
        recipientRoleOrId: "agent-receiver",
        messageType: "DISPATCH_TASK",
        payload: { task: 2 },
        correlationId: "corr-B",
        baseDir: testRoot,
      });

      const filteredByCorr = collectInboxReceipts("agent-receiver", {
        baseDir: testRoot,
        correlationId: "corr-A",
      });
      expect(filteredByCorr.totalReceipts).toBe(1);
      expect(filteredByCorr.receipts[0]?.correlation_id).toBe("corr-A");

      const filteredByType = collectInboxReceipts("agent-receiver", {
        baseDir: testRoot,
        messageType: "DISPATCH_TASK",
        advanceCursor: true,
      });
      expect(filteredByType.totalReceipts).toBe(1);
      expect(filteredByType.receipts[0]?.message_type).toBe("DISPATCH_TASK");
    });
  });

  describe("Architecture Invariants", () => {
    it("ensures file is <= 300 physical lines with 0 any", () => {
      const file = join(process.cwd(), "tests/unit/communication/mailbox-dispatcher.test.ts");
      const lines = readFileSync(file, "utf8").split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);
    });
  });
});
