import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { join, resolve } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { msgListCommand } from "../../../olt/scripts/src/cli/commands/msg-list.ts";
import { msgListenCommand } from "../../../olt/scripts/src/cli/commands/msg-listen.ts";
import { msgRecvCommand } from "../../../olt/scripts/src/cli/commands/msg-recv.ts";
import {
  msgSendCommand,
  VALID_MAILBOX_MESSAGE_TYPES,
} from "../../../olt/scripts/src/cli/commands/msg-send.ts";
import {
  ensureMailboxDirectories,
  loadMailboxCursor,
  resolveMailboxPaths,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  inspectListenerLiveness,
  isListenerAlive,
  isListenerDelivering,
  isListenerStopped,
  isListenerWedged,
  readListenerHeartbeat,
  recordListenerHeartbeat,
  recordListenerStopped,
  removeListenerHeartbeat,
} from "../../../olt/scripts/src/communication/mailbox/liveness.ts";
import {
  releaseInMemoryLock,
  resetInMemoryLocks,
  setInMemoryLocking,
  tryAcquireInMemoryLock,
} from "../../../olt/scripts/src/communication/locking/safe-lock.ts";
import type { MailboxMessageType } from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { startContinuousDrain } from "../../../olt/scripts/src/liaison/agent/index.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mailbox Subsystem Core Invariants Regression Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let testRoot: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    setInMemoryLocking(true);
    const cwd = process.cwd();
    vfs.mkdirSync(cwd, { recursive: true });
    vfs.writeFileSync(join(cwd, "package.json"), "{}");
    testRoot = `/fixture/invariants-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
    resetInMemoryLocks();
    setInMemoryLocking(false);
  });

  describe("Invariant 1: Cursor does not advance on delivery failure", () => {
    it("msgListenCommand: preserves cursor sequence at 0 on write error and redelivers on retry (counterfactual: if reverted, cursor would advance before write completing)", async () => {
      const recipient = "worker-fail-listen";
      const paths = resolveMailboxPaths(recipient, testRoot);
      ensureMailboxDirectories(paths);

      const sendRes = msgSendCommand({
        to: recipient,
        type: "DISPATCH_TASK",
        actor: "coordinator",
        body: "task-101",
        "base-dir": testRoot,
      });
      expect(sendRes.envelope.id).toBeDefined();
      expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(0);

      const writeSpy = spyOn(process.stdout, "write").mockImplementation((() => {
        throw new Error("Output write error");
      }) as unknown as typeof process.stdout.write);

      try {
        await msgListenCommand({
          actor: recipient,
          "base-dir": testRoot,
          timeout: 50,
          "max-messages": 1,
        });
      } catch {
      } finally {
        writeSpy.mockRestore();
      }

      expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(0);
      expect(loadMailboxCursor(paths.cursorPath).seen_ids).toHaveLength(0);

      const retry = await msgListenCommand({
        actor: recipient,
        "base-dir": testRoot,
        timeout: 100,
        "max-messages": 1,
      });
      expect(retry.totalDrained).toBe(1);
      expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(1);
      expect(loadMailboxCursor(paths.cursorPath).seen_ids).toContain(sendRes.envelope.id);
    });

    it("continuous drain: cursor remains at seq 0 when message processor throws (counterfactual: if reverted, autoAdvanceCursor would advance despite rejection)", async () => {
      const agentId = "worker-drain-error";
      const paths = resolveMailboxPaths(agentId, testRoot);
      ensureMailboxDirectories(paths);

      msgSendCommand({
        to: agentId,
        type: "DISPATCH_TASK",
        actor: "coordinator",
        "base-dir": testRoot,
      });

      const handle = startContinuousDrain({
        agentId,
        baseDir: testRoot,
        idleWaitMs: 10,
        autoAdvanceCursor: false,
        emitDeliveredReceipts: false,
        onMessage: async () => {
          throw new Error("Continuous processor error");
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 40));
      await handle.stop();

      expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(0);
      expect(loadMailboxCursor(paths.cursorPath).seen_ids).toHaveLength(0);

      const recv = await msgRecvCommand({
        actor: agentId,
        "base-dir": testRoot,
        "no-advance-cursor": true,
      });
      expect(recv.totalReceipts).toBe(1);
    });
  });

  describe("Invariant 2: Concurrent readers are coordinated and do not blindly consume each other", () => {
    it("msgListenCommand: fails fast on reader collision when listener is already active (counterfactual: if reverted, two listeners would compete uncoordinated)", async () => {
      const agentId = "worker-concurrent-listener";
      const paths = resolveMailboxPaths(agentId, testRoot);
      ensureMailboxDirectories(paths);

      recordListenerHeartbeat(agentId, { baseDir: testRoot, pid: process.pid });

      let collisionError: unknown = null;
      try {
        await msgListenCommand({ actor: agentId, "base-dir": testRoot, timeout: 50 });
      } catch (error) {
        collisionError = error;
      } finally {
        removeListenerHeartbeat(agentId, testRoot);
      }

      expect(collisionError instanceof HarnessError).toBe(true);
      expect((collisionError as HarnessError).code).toBe("INVALID_STATE");
      expect((collisionError as HarnessError).message).toContain("Concurrent reader collision");
    });
  });

  describe("Invariant 3: Torn or corrupt cursor file fails closed rather than skipping", () => {
    it("quarantines truncated JSON and fails closed to sequence 0 without dropping unread messages (counterfactual: if reverted, torn cursor would skip messages)", async () => {
      const agentId = "worker-torn-cursor";
      const paths = resolveMailboxPaths(agentId, testRoot);
      ensureMailboxDirectories(paths);

      const env1 = msgSendCommand({
        to: agentId,
        type: "DISPATCH_TASK",
        actor: "coord",
        "base-dir": testRoot,
      });
      const env2 = msgSendCommand({
        to: agentId,
        type: "DISPATCH_TASK",
        actor: "coord",
        "base-dir": testRoot,
      });

      vfs.writeFileSync(paths.cursorPath, '{"last_read_sequence": 2, "last_read_id": "torn-env-');

      const loadedCursor = loadMailboxCursor(paths.cursorPath);
      expect(loadedCursor.last_read_sequence).toBe(0);
      expect(loadedCursor.seen_ids).toHaveLength(0);

      const files = vfs.readdirSync(paths.agentMailboxDir);
      expect(files.some((f) => f.includes(".corrupt-"))).toBe(true);

      const recvRes = await msgRecvCommand({
        actor: agentId,
        "base-dir": testRoot,
        "no-advance-cursor": true,
      });
      expect(recvRes.totalReceipts).toBe(2);
      expect(recvRes.receipts.map((r) => r.id)).toEqual([env1.envelope.id, env2.envelope.id]);
    });

    it("quarantines invalid schema payload and resets sequence to zero (counterfactual: if reverted, malformed sequence would corrupt cursor calculations)", async () => {
      const agentId = "worker-corrupt-schema";
      const paths = resolveMailboxPaths(agentId, testRoot);
      ensureMailboxDirectories(paths);

      msgSendCommand({ to: agentId, type: "DISPATCH_TASK", actor: "coord", "base-dir": testRoot });
      vfs.writeFileSync(
        paths.cursorPath,
        JSON.stringify({ last_read_sequence: -99, seen_ids: "not-an-array" }),
      );

      const fallbackCursor = loadMailboxCursor(paths.cursorPath);
      expect(fallbackCursor.last_read_sequence).toBe(0);
      expect(fallbackCursor.seen_ids).toEqual([]);

      const recvRes = await msgRecvCommand({
        actor: agentId,
        "base-dir": testRoot,
        "no-advance-cursor": true,
      });
      expect(recvRes.totalReceipts).toBe(1);
    });
  });

  describe("Invariant 4: msg:list reports truthful unread depth and listener active status", () => {
    it("tracks pending depth and active drain lock faithfully across consumption phases (counterfactual: if reverted, msg:list would report static inbox lines or false active status)", async () => {
      const agentId = "worker-list-audit";
      const paths = resolveMailboxPaths(agentId, testRoot);
      ensureMailboxDirectories(paths);

      const initialSummary = msgListCommand({ actor: agentId, "base-dir": testRoot });
      expect(initialSummary.mailboxes[0]?.unreadCount).toBe(0);
      expect(initialSummary.mailboxes[0]?.listenerActive).toBe(false);

      msgSendCommand({ to: agentId, type: "DISPATCH_TASK", actor: "coord", "base-dir": testRoot });
      msgSendCommand({ to: agentId, type: "DISPATCH_TASK", actor: "coord", "base-dir": testRoot });
      msgSendCommand({ to: agentId, type: "DISPATCH_TASK", actor: "coord", "base-dir": testRoot });

      const midSummary1 = msgListCommand({ actor: agentId, "base-dir": testRoot });
      expect(midSummary1.mailboxes[0]?.unreadCount).toBe(3);
      expect(midSummary1.unreadDepth).toBe(3);
      expect(midSummary1.mailboxes[0]?.listenerActive).toBe(false);

      const drainLockPath = `${paths.lockPath.slice(0, -5)}.drain.lock`;
      const drainLock = tryAcquireInMemoryLock(drainLockPath, `listener-${agentId}-${process.pid}`);
      recordListenerHeartbeat(agentId, { baseDir: testRoot, pid: process.pid });
      const midSummaryWithLock = msgListCommand({ actor: agentId, "base-dir": testRoot });
      expect(midSummaryWithLock.mailboxes[0]?.listenerActive).toBe(true);

      releaseInMemoryLock(drainLockPath, drainLock.fd as number);
      recordListenerStopped(agentId, testRoot, "normal_drain");
      const midSummaryStopped = msgListCommand({ actor: agentId, "base-dir": testRoot });
      expect(midSummaryStopped.mailboxes[0]?.listenerActive).toBe(false);

      await msgRecvCommand({ actor: agentId, "base-dir": testRoot });

      const drainedSummary = msgListCommand({ actor: agentId, "base-dir": testRoot });
      expect(drainedSummary.mailboxes[0]?.unreadCount).toBe(0);
      expect(drainedSummary.mailboxes[0]?.lastReadSequence).toBe(1);

      msgSendCommand({ to: agentId, type: "DISPATCH_TASK", actor: "coord", "base-dir": testRoot });
      const finalSummary = msgListCommand({ actor: agentId, "base-dir": testRoot });
      expect(finalSummary.mailboxes[0]?.unreadCount).toBe(1);
    });
  });
});
