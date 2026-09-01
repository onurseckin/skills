import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSignedEnvelope,
  verifyEnvelopeHmac,
} from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import {
  broadcastWaveNotification,
  clearInMemoryCursors,
  collectInboxReceipts,
  dispatchPeerMessage,
  getInMemoryCursor,
  resolveRecipientAgentIds,
} from "../../../olt/scripts/src/communication/mailbox/mailbox-dispatcher.ts";
import {
  clearInMemoryMailboxDirs,
  registerInMemoryMailboxDir,
  resolveMailboxPaths,
} from "../../../olt/scripts/src/communication/mailbox/mailbox-paths.ts";
import {
  clearInMemoryMailboxStore,
  getInMemoryMailbox,
  setInMemoryStreamMode,
} from "../../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import type { MailboxEnvelope } from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("P2P Mailbox Dispatcher & Role Resolution (In-Memory)", () => {
  const virtualRoot = "virtual://dispatcher-suite";

  beforeEach(() => {
    clearInMemoryMailboxStore();
    clearInMemoryMailboxDirs();
    clearInMemoryCursors();
    setInMemoryStreamMode(true);
  });

  afterEach(() => {
    clearInMemoryMailboxStore();
    clearInMemoryMailboxDirs();
    clearInMemoryCursors();
    setInMemoryStreamMode(false);
  });

  describe("resolveRecipientAgentIds", () => {
    it("resolves exact matches and role substrings from registered in-memory mailbox directories", () => {
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/mailboxes/worker-alpha");
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/mailboxes/worker_beta");
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/mailboxes/lead_worker_node");
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/mailboxes/coordinator-0");
      registerInMemoryMailboxDir(
        "virtual://dispatcher-suite/.olt/locks/mailboxes/validator-1.lock",
      );
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/locks/mailboxes/repairer-1.lock");

      expect(resolveRecipientAgentIds("worker-alpha", virtualRoot)).toEqual(["worker-alpha"]);
      expect(resolveRecipientAgentIds("worker", virtualRoot)).toEqual([
        "lead_worker_node",
        "worker-alpha",
        "worker_beta",
      ]);
      expect(resolveRecipientAgentIds("coordinator", virtualRoot)).toEqual(["coordinator-0"]);
      expect(resolveRecipientAgentIds("validator", virtualRoot)).toEqual(["validator-1"]);
      expect(resolveRecipientAgentIds("repairer", virtualRoot)).toEqual(["repairer-1"]);
      expect(resolveRecipientAgentIds("custom-agent-99", virtualRoot)).toEqual(["custom-agent-99"]);

      const all = resolveRecipientAgentIds("*", virtualRoot);
      expect(all.length).toBeGreaterThanOrEqual(4);
    });

    it("rejects invalid roles, empty strings, and path traversal attempts", () => {
      expect(() => resolveRecipientAgentIds("", virtualRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("   ", virtualRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds(123 as unknown as string, virtualRoot)).toThrow(
        HarnessError,
      );
      expect(() => resolveRecipientAgentIds(".", virtualRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("../outside", virtualRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("sub/agent", virtualRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("sub\\agent", virtualRoot)).toThrow(HarnessError);
      expect(() => resolveRecipientAgentIds("null\0byte", virtualRoot)).toThrow(HarnessError);
    });
  });

  describe("dispatchPeerMessage", () => {
    it("signs envelope with HMAC and appends to in-memory recipient inbox and sender outbox", () => {
      const envelope = dispatchPeerMessage({
        senderId: "coordinator-1",
        senderRole: "coordinator",
        recipientRoleOrId: "worker-1",
        messageType: "DISPATCH_TASK",
        payload: { task: "process-chunk", chunkId: 42 },
        correlationId: "corr-100",
        baseDir: virtualRoot,
      });

      expect(envelope.id).toBeDefined();
      expect(envelope.sender_id).toBe("coordinator-1");
      expect(envelope.recipient_id).toBe("worker-1");
      expect(envelope.correlation_id).toBe("corr-100");
      expect(verifyEnvelopeHmac(envelope).valid).toBe(true);

      const recipientPaths = resolveMailboxPaths("worker-1", virtualRoot);
      const senderPaths = resolveMailboxPaths("coordinator-1", virtualRoot);

      const inboxLines = getInMemoryMailbox(recipientPaths.inboxPath) ?? [];
      expect(inboxLines.length).toBe(1);
      const firstInbox = inboxLines[0];
      expect(firstInbox).toBeDefined();
      if (firstInbox !== undefined) {
        const parsedInbox = JSON.parse(firstInbox) as MailboxEnvelope<{ task: string }>;
        expect(parsedInbox.id).toBe(envelope.id);
        expect(parsedInbox.payload.task).toBe("process-chunk");
      }

      const outboxLines = getInMemoryMailbox(senderPaths.outboxPath) ?? [];
      expect(outboxLines.length).toBe(1);
    });

    it("resolves role name and multi-recipient broadcasts on dispatch in memory", () => {
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/mailboxes/worker-42");
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/mailboxes/worker-43");
      const envelope = dispatchPeerMessage({
        senderId: "coord-1",
        senderRole: "coordinator",
        recipientRoleOrId: "worker",
        messageType: "DISPATCH_TASK",
        payload: { ready: true },
        baseDir: virtualRoot,
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
          senderId: "coordinator-1",
          senderRole: "coordinator",
          recipientRoleOrId: "*",
          messageType: "DISPATCH_TASK",
          payload: {},
          baseDir: "/nonexistent-empty-root",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("broadcastWaveNotification", () => {
    it("dispatches notifications to all target recipients in-memory and resolves roles", () => {
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/mailboxes/worker-a");
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/mailboxes/worker-b");
      registerInMemoryMailboxDir("virtual://dispatcher-suite/.olt/mailboxes/validator-1");

      const envelopes = broadcastWaveNotification({
        senderId: "coordinator-0",
        senderRole: "coordinator",
        recipientIds: ["worker", "worker-a", "validator-1"],
        messageType: "PULSE_HEARTBEAT",
        payload: { wave: 1 },
        correlationId: "wave-corr-1",
        baseDir: virtualRoot,
      });

      expect(envelopes.length).toBe(3);
      const recipientIds = envelopes.map((e) => e.recipient_id).sort();
      expect(recipientIds).toEqual(["validator-1", "worker-a", "worker-b"]);

      for (const id of recipientIds) {
        const inbox = resolveMailboxPaths(id, virtualRoot).inboxPath;
        const lines = getInMemoryMailbox(inbox) ?? [];
        expect(lines.length).toBe(1);
      }
    });

    it("returns empty array when recipient list is empty and rejects non-array", () => {
      const res = broadcastWaveNotification({
        senderId: "c-1",
        senderRole: "c",
        recipientIds: [],
        messageType: "PULSE_HEARTBEAT",
        payload: {},
        baseDir: virtualRoot,
      });
      expect(res).toEqual([]);
      expect(() =>
        broadcastWaveNotification(
          null as unknown as Parameters<typeof broadcastWaveNotification>[0],
        ),
      ).toThrow(HarnessError);
    });
  });

  describe("collectInboxReceipts & in-memory cursor tracking", () => {
    it("collects unread messages, filters by correlationId/messageType, and advances in-memory cursor", () => {
      dispatchPeerMessage({
        senderId: "agent-sender",
        senderRole: "sender",
        recipientRoleOrId: "agent-receiver",
        messageType: "HANDOFF_RECEIPT",
        payload: { task: 1 },
        correlationId: "corr-A",
        baseDir: virtualRoot,
      });
      dispatchPeerMessage({
        senderId: "agent-sender",
        senderRole: "sender",
        recipientRoleOrId: "agent-receiver",
        messageType: "DISPATCH_TASK",
        payload: { task: 2 },
        correlationId: "corr-B",
        baseDir: virtualRoot,
      });

      const filteredByCorr = collectInboxReceipts("agent-receiver", {
        baseDir: virtualRoot,
        correlationId: "corr-A",
      });
      expect(filteredByCorr.totalReceipts).toBe(1);
      expect(filteredByCorr.receipts[0]?.correlation_id).toBe("corr-A");

      const receiverPaths = resolveMailboxPaths("agent-receiver", virtualRoot);
      const filteredByType = collectInboxReceipts("agent-receiver", {
        baseDir: virtualRoot,
        messageType: "DISPATCH_TASK",
        advanceCursor: true,
      });
      expect(filteredByType.totalReceipts).toBe(1);
      expect(filteredByType.receipts[0]?.message_type).toBe("DISPATCH_TASK");

      const savedCursor = getInMemoryCursor(receiverPaths.cursorPath);
      expect(savedCursor).toBeDefined();
      expect(savedCursor?.seen_ids.length).toBeGreaterThan(0);
    });
  });
});
