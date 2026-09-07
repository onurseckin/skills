import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { msgRecvCommand } from "../../../../olt/scripts/src/cli/commands/msg-recv.ts";
import {
  ensureMailboxDirectories,
  resolveMailboxPaths,
} from "../../../../olt/scripts/src/communication/mailbox/mailbox-paths.ts";
import {
  appendMailboxMessage,
  clearInMemoryMailboxStore,
} from "../../../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import {
  createSignedEnvelope,
  DEFAULT_REPO_SECRET,
} from "../../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS, vfs } from "../../helpers.ts";

describe("Mailbox Recv Filtering and Polling Wait Rules", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    clearInMemoryMailboxStore();
    testRoot = `/fixture/msg-recv-wait-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    clearInMemoryMailboxStore();
    cleanupVirtualCommunicationFS();
  });

  describe("Message Filtering, HMAC Verification, and Previews", () => {
    it("filters receipts by message type and correlation id", async () => {
      const actor = "filter-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      const env1 = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "SYSTEM_ALERT",
        payload: { alert: 1 },
        sequence: 1,
        correlationId: "corr-alert",
      });
      const env2 = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "DISPATCH_TASK",
        payload: { task: 2 },
        sequence: 2,
        correlationId: "corr-task",
      });
      appendMailboxMessage(paths.inboxPath, env1, paths.lockPath);
      appendMailboxMessage(paths.inboxPath, env2, paths.lockPath);

      const typeRes = await msgRecvCommand({
        actor,
        "base-dir": testRoot,
        type: "SYSTEM_ALERT",
        "no-advance-cursor": true,
      });
      expect(typeRes.totalReceipts).toBe(1);
      expect(typeRes.receipts[0]?.message_type).toBe("SYSTEM_ALERT");

      const corrRes = await msgRecvCommand({
        actor,
        "base-dir": testRoot,
        "correlation-id": "corr-task",
        "no-advance-cursor": true,
      });
      expect(corrRes.totalReceipts).toBe(1);
      expect(corrRes.receipts[0]?.correlation_id).toBe("corr-task");
    });

    it("verifies HMAC with default secret and evaluates custom secrets correctly", async () => {
      const actor = "hmac-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      const env = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "PING",
        payload: {},
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const defaultSecretRes = await msgRecvCommand({
        actor,
        "base-dir": testRoot,
        secret: DEFAULT_REPO_SECRET,
        "no-advance-cursor": true,
      });
      expect(defaultSecretRes.receipts[0]?.metadata.verified).toBe(true);

      const wrongSecretRes = await msgRecvCommand({
        actor,
        "base-dir": testRoot,
        secret: "wrong-invalid-secret",
        "no-advance-cursor": true,
      });
      expect(wrongSecretRes.receipts[0]?.metadata.verified).toBe(false);
    });

    it("truncates message preview when received receipts exceed 5", async () => {
      const actor = "many-msgs-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      for (let i = 1; i <= 7; i++) {
        const env = createSignedEnvelope({
          senderId: "coord",
          senderRole: "c",
          recipientId: actor,
          messageType: "PING",
          payload: { idx: i },
          sequence: i,
        });
        appendMailboxMessage(paths.inboxPath, env, paths.lockPath);
      }

      const res = await msgRecvCommand({ actor, "base-dir": testRoot, "no-advance-cursor": true });
      expect(res.totalReceipts).toBe(7);
      expect(res.markdown).toContain("- ... and 2 more");
    });
  });

  describe("Actor Fallbacks and Polling Wait Loop", () => {
    it("resolves recipient actor from authenticated caller context and fallback", async () => {
      const actor = "caller-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      const env = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "COMPLETE",
        payload: {},
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const res = await msgRecvCommand(
        { "base-dir": testRoot, "no-advance-cursor": true },
        { authenticatedCaller: { actor, role: "worker", verified: true, mechanisms: [] } },
      );
      expect(res.actor).toBe("caller-agent");
      expect(res.totalReceipts).toBe(1);

      const fallbackRes = await msgRecvCommand({ "base-dir": testRoot, "no-advance-cursor": true });
      expect(typeof fallbackRes.actor).toBe("string");
      expect(fallbackRes.actor.length).toBeGreaterThan(0);
    });

    it("times out cleanly when wait flag is specified on empty mailbox", async () => {
      const res = await msgRecvCommand({
        actor: "empty-wait-agent",
        "base-dir": testRoot,
        wait: true,
        timeout: 60,
      });
      expect(res.totalReceipts).toBe(0);
      expect(res.metadata?.deliveryStatus).toBe("UNREAD");
    });

    it("receives asynchronously delivered message during wait polling loop", async () => {
      const actor = "async-wait-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      setTimeout(() => {
        const env = createSignedEnvelope({
          senderId: "coord",
          senderRole: "c",
          recipientId: actor,
          messageType: "WAKE",
          payload: { awake: true },
          sequence: 1,
          correlationId: "corr-wake",
        });
        appendMailboxMessage(paths.inboxPath, env, paths.lockPath);
      }, 25);

      const res = await msgRecvCommand({
        actor,
        "base-dir": testRoot,
        wait: true,
        timeout: 500,
        type: "WAKE",
        "correlation-id": "corr-wake",
      });
      expect(res.totalReceipts).toBe(1);
      expect(res.receipts[0]?.message_type).toBe("WAKE");
    });

    it("returns immediately without polling when wait is true and receipts already exist", async () => {
      const actor = "instant-wait-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      const env = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "PING",
        payload: {},
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const res = await msgRecvCommand({
        actor,
        "base-dir": testRoot,
        wait: true,
        timeout: 5000,
        "no-advance-cursor": true,
      });
      expect(res.totalReceipts).toBe(1);
    });
  });
});
