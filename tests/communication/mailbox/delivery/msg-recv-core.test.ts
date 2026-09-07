import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { msgRecvCommand } from "../../../../olt/scripts/src/cli/commands/msg-recv.ts";
import {
  ensureMailboxDirectories,
  resolveMailboxPaths,
} from "../../../../olt/scripts/src/communication/mailbox/mailbox-paths.ts";
import {
  appendMailboxMessage,
  clearInMemoryMailboxStore,
  setInMemoryStreamMode,
} from "../../../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import { createSignedEnvelope } from "../../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { loadMailboxCursor } from "../../../../olt/scripts/src/communication/mailbox/cursor-tracker.ts";
import {
  clearInMemoryHeartbeats,
  recordListenerHeartbeat,
} from "../../../../olt/scripts/src/communication/mailbox/liveness.ts";
import * as locking from "../../../../olt/scripts/src/communication/locking/index.ts";
import {
  acquireMailboxLock,
  releaseMailboxLock,
  resetInMemoryLocks,
  setInMemoryLocking,
  tryAcquireInMemoryLock,
} from "../../../../olt/scripts/src/communication/locking/index.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS, vfs } from "../../helpers.ts";

describe("Mailbox Recv Command Core Rules", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    clearInMemoryHeartbeats();
    clearInMemoryMailboxStore();
    setInMemoryLocking(true);
    testRoot = `/fixture/msg-recv-core-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    clearInMemoryHeartbeats();
    clearInMemoryMailboxStore();
    resetInMemoryLocks();
    setInMemoryLocking(false);
    setInMemoryStreamMode(false);
    cleanupVirtualCommunicationFS();
  });

  describe("Real CLI Entry Point Execution", () => {
    it("drives execute CLI on empty mailbox with no-advance-cursor", async () => {
      const result = (await execute([
        "msg:recv",
        "--actor",
        "recv-cli",
        "--base-dir",
        testRoot,
        "--no-advance-cursor",
      ])) as { actor: string; totalReceipts: number; advanceCursor: boolean; markdown: string };

      expect(result.actor).toBe("recv-cli");
      expect(result.totalReceipts).toBe(0);
      expect(result.advanceCursor).toBe(false);
      expect(result.markdown).toContain("### Mailbox Messages Received (`msg:recv`)");
      expect(result.markdown).toContain("- **Actor**: `recv-cli`");
    });

    it("drives execute CLI with seeded message advancing cursor", async () => {
      const paths = resolveMailboxPaths("recv-cli-seed", testRoot);
      ensureMailboxDirectories(paths);
      const env = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: "recv-cli-seed",
        messageType: "DISPATCH_TASK",
        payload: { task: "exec" },
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const result = (await execute([
        "msg:recv",
        "--actor",
        "recv-cli-seed",
        "--base-dir",
        testRoot,
      ])) as { totalReceipts: number; advanceCursor: boolean; receipts: readonly { id: string }[] };

      expect(result.totalReceipts).toBe(1);
      expect(result.advanceCursor).toBe(true);
      expect(result.receipts[0]?.id).toBe(env.id);
    });
  });

  describe("Cursor Advancement and Coordination Rules", () => {
    it("advances mailbox cursor by default on receipt collection", async () => {
      const actor = "advancing-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      const env = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "DIRECTIVE",
        payload: { run: true },
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const res = await msgRecvCommand({ actor, "base-dir": testRoot });
      expect(res.totalReceipts).toBe(1);
      expect(res.advanceCursor).toBe(true);
      expect(res.receipts[0]?.delivery_status).toBe("MARKED-READ");
      expect(res.receipts[0]?.read).toBe(true);
      expect(res.receipts[0]?.metadata.cursor_advanced).toBe(true);

      const cursor = loadMailboxCursor(paths.cursorPath);
      expect(cursor.last_read_sequence).toBe(1);
      expect(cursor.seen_ids).toContain(env.id);
    });

    it("does not advance cursor when no-advance-cursor or advance-cursor=false is passed", async () => {
      const actor = "peek-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      const env = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "QUESTION",
        payload: { q: 1 },
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const res = await msgRecvCommand({ actor, "base-dir": testRoot, "no-advance-cursor": true });
      expect(res.totalReceipts).toBe(1);
      expect(res.advanceCursor).toBe(false);
      expect(res.receipts[0]?.delivery_status).toBe("DELIVERED");
      expect(res.receipts[0]?.read).toBe(false);

      const cursor = loadMailboxCursor(paths.cursorPath);
      expect(cursor.last_read_sequence).toBe(0);

      const resFalse = await msgRecvCommand({
        actor,
        "base-dir": testRoot,
        "advance-cursor": "false",
      });
      expect(resFalse.advanceCursor).toBe(false);
    });

    it("prevents cursor advancement and reports active inspection when listener is running", async () => {
      const actor = "monitored-recv-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      recordListenerHeartbeat({
        actor,
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date().toISOString(),
        lastDeliveredTimestamp: new Date().toISOString(),
      });

      const env = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "ACK",
        payload: {},
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const res = await msgRecvCommand({ actor, "base-dir": testRoot });
      expect(res.totalReceipts).toBe(1);
      expect(res.listenerActive).toBe(true);
      expect(res.advanceCursor).toBe(false);
      expect(res.markdown).toContain("- **Coordination**: `listener_active_safe_inspection`");

      const cursor = loadMailboxCursor(paths.cursorPath);
      expect(cursor.last_read_sequence).toBe(0);
    });

    it("falls back to non-advancing read when drain lock is held in memory", async () => {
      const actor = "locked-drain-agent";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      const drainLockPath = paths.lockPath.replace(/\.lock$/, ".drain.lock");
      tryAcquireInMemoryLock(drainLockPath, "external-drain-holder");

      const env = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "STATUS",
        payload: { code: 200 },
        sequence: 1,
      });
      appendMailboxMessage(paths.inboxPath, env, paths.lockPath);

      const res = await msgRecvCommand({ actor, "base-dir": testRoot });
      expect(res.totalReceipts).toBe(1);
      expect(res.advanceCursor).toBe(false);
    });

    it("operates with file-based drain locking when in-memory locking is disabled", async () => {
      setInMemoryLocking(false);
      const actor = "fs-lock-agent";
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

      const res = await msgRecvCommand({ actor, "base-dir": testRoot });
      expect(res.totalReceipts).toBe(1);
      expect(res.advanceCursor).toBe(true);

      const drainLockPath = paths.lockPath.replace(/\.lock$/, ".drain.lock");
      const extLock = acquireMailboxLock(drainLockPath, "external-holder", { timeoutMs: 0 });
      expect(extLock.acquired).toBe(true);

      const env2 = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "PING",
        payload: {},
        sequence: 2,
      });
      appendMailboxMessage(paths.inboxPath, env2, paths.lockPath);

      const resLocked = await msgRecvCommand({ actor, "base-dir": testRoot });
      expect(resLocked.totalReceipts).toBe(1);
      expect(resLocked.advanceCursor).toBe(false);

      releaseMailboxLock(extLock);
    });

    it("handles drain lock acquisition failure during reader advance", async () => {
      const actor = "drain-fail-agent";
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

      const origAcquire = locking.tryAcquireInMemoryLock;
      const spy = spyOn(locking, "tryAcquireInMemoryLock").mockImplementation((p, h) => {
        if (h.startsWith("reader-")) {
          return { acquired: false, fd: null, holderPid: 888 };
        }
        return origAcquire(p, h);
      });
      try {
        const res = await msgRecvCommand({ actor, "base-dir": testRoot });
        expect(res.totalReceipts).toBe(1);
        expect(res.advanceCursor).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
