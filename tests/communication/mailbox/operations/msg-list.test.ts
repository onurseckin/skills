import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { msgListCommand } from "../../../../olt/scripts/src/cli/commands/msg-list.ts";
import {
  ensureMailboxDirectories,
  registerInMemoryMailboxDir,
  resolveMailboxPaths,
} from "../../../../olt/scripts/src/communication/mailbox/mailbox-paths.ts";
import {
  appendMailboxMessage,
  clearInMemoryMailboxStore,
  setInMemoryMailbox,
  setInMemoryStreamMode,
} from "../../../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import { setInMemoryQuarantine } from "../../../../olt/scripts/src/communication/mailbox/quarantine.ts";
import { createSignedEnvelope } from "../../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { advanceMailboxCursor } from "../../../../olt/scripts/src/communication/mailbox/cursor-tracker.ts";
import {
  clearInMemoryHeartbeats,
  recordListenerHeartbeat,
  recordListenerStopped,
} from "../../../../olt/scripts/src/communication/mailbox/liveness.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS, vfs } from "../../helpers.ts";

describe("Mailbox List Command Subsystem", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    clearInMemoryHeartbeats();
    clearInMemoryMailboxStore();
    testRoot = `/fixture/msg-list-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    clearInMemoryHeartbeats();
    clearInMemoryMailboxStore();
    setInMemoryStreamMode(false);
    cleanupVirtualCommunicationFS();
  });

  describe("Real CLI Entry Point Execution", () => {
    it("drives execute CLI on empty repository root", async () => {
      const result = (await execute(["msg:list", "--base-dir", testRoot])) as {
        markdown: string;
        totalMailboxes: number;
        unreadDepth: number;
      };
      expect(result.totalMailboxes).toBe(0);
      expect(result.unreadDepth).toBe(0);
      expect(result.markdown).toContain("_No mailboxes found._");
    });

    it("drives execute CLI with specific actor and message seeding", async () => {
      const paths = resolveMailboxPaths("worker-cli", testRoot);
      ensureMailboxDirectories(paths);
      const env = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: "worker-cli",
        messageType: "DISPATCH_TASK",
        payload: { item: 1 },
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const result = (await execute([
        "msg:list",
        "--base-dir",
        testRoot,
        "--actor",
        "worker-cli",
      ])) as {
        mailboxes: readonly { agentId: string; inboxCount: number; unreadCount: number }[];
        totalMailboxes: number;
      };
      expect(result.totalMailboxes).toBe(1);
      expect(result.mailboxes[0]?.agentId).toBe("worker-cli");
      expect(result.mailboxes[0]?.inboxCount).toBe(1);
      expect(result.mailboxes[0]?.unreadCount).toBe(1);
    });
  });

  describe("Mailbox Summaries and Delivery State", () => {
    it("computes delivery state across inbox, outbox, and recipient cursor", () => {
      const senderPaths = resolveMailboxPaths("sender-agent", testRoot);
      const recipientPaths = resolveMailboxPaths("recv-agent", testRoot);
      ensureMailboxDirectories(senderPaths);
      ensureMailboxDirectories(recipientPaths);

      const envDelivered = createSignedEnvelope({
        senderId: "sender-agent",
        senderRole: "s",
        recipientId: "recv-agent",
        messageType: "DISPATCH_TASK",
        payload: { work: "A" },
        sequence: 1,
      });
      const envUndelivered = createSignedEnvelope({
        senderId: "sender-agent",
        senderRole: "s",
        recipientId: "other-missing-agent",
        messageType: "SYSTEM_ALERT",
        payload: { work: "B" },
        sequence: 2,
      });

      appendMailboxMessage(senderPaths.outboxPath, envDelivered, senderPaths.lockPath);
      appendMailboxMessage(senderPaths.outboxPath, envUndelivered, senderPaths.lockPath);
      appendMailboxMessage(recipientPaths.inboxPath, envDelivered, recipientPaths.lockPath);

      const senderSummary = msgListCommand({ "base-dir": testRoot, actor: "sender-agent" });
      expect(senderSummary.totalMailboxes).toBe(1);
      expect(senderSummary.mailboxes[0]?.outboxCount).toBe(2);

      const outDelivered = senderSummary.mailboxes[0]?.outboxMessages.find(
        (m) => m.id === envDelivered.id,
      );
      expect(outDelivered?.status).toBe("DELIVERED");
      expect(outDelivered?.delivered).toBe(true);
      expect(outDelivered?.seen).toBe(false);

      const outUndelivered = senderSummary.mailboxes[0]?.outboxMessages.find(
        (m) => m.id === envUndelivered.id,
      );
      expect(outUndelivered?.status).toBe("UNDELIVERED");
      expect(outUndelivered?.delivered).toBe(false);

      advanceMailboxCursor(
        recipientPaths.cursorPath,
        envDelivered,
        undefined,
        recipientPaths.lockPath,
      );

      const senderAfterRead = msgListCommand({ "base-dir": testRoot, actor: "sender-agent" });
      const outMarkedRead = senderAfterRead.mailboxes[0]?.outboxMessages.find(
        (m) => m.id === envDelivered.id,
      );
      expect(outMarkedRead?.status).toBe("MARKED-READ");
      expect(outMarkedRead?.seen).toBe(true);

      const recipientSummary = msgListCommand({ "base-dir": testRoot, actor: "recv-agent" });
      expect(recipientSummary.mailboxes[0]?.inboxCount).toBe(1);
      expect(recipientSummary.mailboxes[0]?.unreadCount).toBe(0);
      expect(recipientSummary.mailboxes[0]?.markedReadCount).toBe(1);
    });

    it("tracks unread depth and quarantine line counts", () => {
      const paths = resolveMailboxPaths("quarantine-agent", testRoot);
      ensureMailboxDirectories(paths);

      const env1 = createSignedEnvelope({
        senderId: "lead",
        senderRole: "l",
        recipientId: "quarantine-agent",
        messageType: "DIRECTIVE",
        payload: { count: 1 },
        sequence: 1,
      });
      const env2 = createSignedEnvelope({
        senderId: "lead",
        senderRole: "l",
        recipientId: "quarantine-agent",
        messageType: "DIRECTIVE",
        payload: { count: 2 },
        sequence: 2,
      });
      appendMailboxMessage(paths.inboxPath, env1, paths.lockPath);
      appendMailboxMessage(paths.inboxPath, env2, paths.lockPath);

      vfs.writeFileSync(paths.quarantinePath, "corrupt-dead-letter-1\ncorrupt-dead-letter-2\n");

      const res = msgListCommand({ "base-dir": testRoot, actor: "quarantine-agent" });
      expect(res.mailboxes[0]?.unreadCount).toBe(2);
      expect(res.mailboxes[0]?.quarantineCount).toBe(2);
      expect(res.unreadDepth).toBe(2);
    });

    it("reflects listener liveness status and active drain lock", () => {
      const actor = "liveness-monitored-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      recordListenerHeartbeat({
        actor,
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date().toISOString(),
      });
      const runningRes = msgListCommand({ "base-dir": testRoot, actor });
      expect(runningRes.mailboxes[0]?.listenerActive).toBe(true);
      expect(runningRes.mailboxes[0]?.listenerStatus).toBe("no_messages");

      recordListenerStopped(actor, testRoot, "done");
      const stoppedRes = msgListCommand({ "base-dir": testRoot, actor });
      expect(stoppedRes.mailboxes[0]?.listenerActive).toBe(false);
      expect(stoppedRes.mailboxes[0]?.listenerStatus).toBe("stopped");

      const drainLockPath = paths.lockPath.replace(/\.lock$/, ".drain.lock");
      vfs.writeFileSync(drainLockPath, String(process.pid));
      const drainRes = msgListCommand({ "base-dir": testRoot, actor });
      expect(drainRes.mailboxes[0]?.listenerActive).toBe(false);
    });
  });

  describe("Filtering, Discovery, and Output Formatting", () => {
    it("discovers all agent mailboxes in sorted order when actor flag is omitted", () => {
      const p1 = resolveMailboxPaths("zebra-agent", testRoot);
      const p2 = resolveMailboxPaths("alpha-agent", testRoot);
      ensureMailboxDirectories(p1);
      ensureMailboxDirectories(p2);

      const res = msgListCommand({ "base-dir": testRoot });
      expect(res.totalMailboxes).toBe(2);
      expect(res.mailboxes[0]?.agentId).toBe("alpha-agent");
      expect(res.mailboxes[1]?.agentId).toBe("zebra-agent");
      expect(res.markdown).toContain("### Mailbox Summaries (`msg:list`)");
      expect(res.markdown).toContain("`alpha-agent`");
      expect(res.markdown).toContain("`zebra-agent`");
    });

    it("discovers in-memory registered mailbox directories", () => {
      registerInMemoryMailboxDir("/virtual/custom-reg/virt-reg-agent");
      const res = msgListCommand({ "base-dir": "/virtual/custom-reg" });
      const found = res.mailboxes.some((m) => m.agentId === "virt-reg-agent");
      expect(found).toBe(true);
    });

    it("looks up specific message by message-id when present and missing", () => {
      const paths = resolveMailboxPaths("lookup-agent", testRoot);
      ensureMailboxDirectories(paths);

      const env = createSignedEnvelope({
        senderId: "author",
        senderRole: "a",
        recipientId: "lookup-agent",
        messageType: "PING",
        payload: { ping: true },
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const foundRes = msgListCommand({
        "base-dir": testRoot,
        actor: "lookup-agent",
        "message-id": env.id,
      });
      expect(foundRes.markdown).toContain(`### Message Delivery Status (\`${env.id}\`)`);
      expect(foundRes.markdown).toContain("- **Delivered**: `true`");
      expect(foundRes.messagesById[env.id]?.id).toBe(env.id);

      const notFoundRes = msgListCommand({
        "base-dir": testRoot,
        actor: "lookup-agent",
        id: "missing-message-id",
      });
      expect(notFoundRes.markdown).toContain("### Message Delivery Status (`missing-message-id`)");
      expect(notFoundRes.markdown).toContain("- **Status**: `NOT_FOUND`");
    });

    it("truncates detailed message preview when messages exceed 10", () => {
      const paths = resolveMailboxPaths("busy-agent", testRoot);
      ensureMailboxDirectories(paths);

      for (let i = 1; i <= 12; i++) {
        const env = createSignedEnvelope({
          senderId: "stream",
          senderRole: "s",
          recipientId: "busy-agent",
          messageType: "STATUS",
          payload: { idx: i },
          sequence: i,
        });
        appendMailboxMessage(paths.inboxPath, env, paths.lockPath);
      }

      const detailedRes = msgListCommand({
        "base-dir": testRoot,
        actor: "busy-agent",
        detailed: true,
      });
      expect(detailedRes.markdown).toContain("### Per-Message Delivery Status");
      expect(detailedRes.markdown).toContain("- ... and 2 more");
    });

    it("handles effective base directory ending with .olt directly", () => {
      const oltRoot = join(testRoot, ".olt");
      vfs.mkdirSync(oltRoot, { recursive: true });
      const paths = resolveMailboxPaths("olt-direct-agent", testRoot);
      ensureMailboxDirectories(paths);

      const env = createSignedEnvelope({
        senderId: "src",
        senderRole: "s",
        recipientId: "olt-direct-agent",
        messageType: "ACK",
        payload: {},
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const res = msgListCommand({ "base-dir": oltRoot, actor: "olt-direct-agent" });
      expect(res.totalMailboxes).toBe(1);
      expect(res.mailboxes[0]?.inboxCount).toBe(1);
    });

    it("executes in-memory stream mode correctly", () => {
      setInMemoryStreamMode(true);
      const memBase = "/virtual/msg-list-mem";
      const paths = resolveMailboxPaths("mem-agent", memBase);

      const env = createSignedEnvelope({
        senderId: "mem-s",
        senderRole: "s",
        recipientId: "mem-agent",
        messageType: "PING",
        payload: {},
        sequence: 1,
      });
      setInMemoryMailbox(paths.inboxPath, [JSON.stringify(env), "", "   "]);
      setInMemoryQuarantine(paths.quarantinePath, ["quarantine-line-1", "quarantine-line-2"]);

      const res = msgListCommand({ "base-dir": memBase, actor: "mem-agent" });
      expect(res.totalMailboxes).toBe(1);
      expect(res.mailboxes[0]?.inboxCount).toBe(1);
      expect(res.mailboxes[0]?.quarantineCount).toBe(2);
    });
  });
});
