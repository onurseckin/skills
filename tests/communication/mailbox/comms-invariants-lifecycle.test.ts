import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { msgListCommand } from "../../../olt/scripts/src/cli/commands/msg-list.ts";
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
} from "../../../olt/scripts/src/communication/mailbox/liveness.ts";
import {
  resetInMemoryLocks,
  setInMemoryLocking,
} from "../../../olt/scripts/src/communication/locking/safe-lock.ts";
import type { MailboxMessageType } from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mailbox Subsystem Lifecycle and Authority Regression Suite", () => {
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
    testRoot = `/fixture/lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
    resetInMemoryLocks();
    setInMemoryLocking(false);
  });

  describe("Invariant 5: Liveness inspect accurately reports running_and_delivering, wedged, stopped, no_messages", () => {
    it("differentiates all 4 listener liveness states truthfully (counterfactual: if reverted, idle workers would be wedged or dead workers reported running)", () => {
      const now = Date.now();

      recordListenerHeartbeat("worker-live", {
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now).toISOString(),
        lastDeliveredTimestamp: new Date(now).toISOString(),
      });
      const liveRes = inspectListenerLiveness("worker-live", {
        baseDir: testRoot,
        nowMs: now,
        unreadCount: 1,
      });
      expect(liveRes.status).toBe("running_and_delivering");
      expect(liveRes.state).toBe("RUNNING_AND_DELIVERING");
      expect(liveRes.isRunning).toBe(true);
      expect(liveRes.isDelivering).toBe(true);
      expect(isListenerDelivering("worker-live", { baseDir: testRoot, nowMs: now })).toBe(true);

      recordListenerHeartbeat("worker-idle", {
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now).toISOString(),
        lastDeliveredTimestamp: null,
      });
      const idleRes = inspectListenerLiveness("worker-idle", {
        baseDir: testRoot,
        nowMs: now,
        unreadCount: 0,
      });
      expect(idleRes.status).toBe("no_messages");
      expect(idleRes.hasNoMessages).toBe(true);
      expect(idleRes.isRunning).toBe(true);
      expect(idleRes.isDelivering).toBe(false);

      recordListenerHeartbeat("worker-wedged-stale", {
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now - 15000).toISOString(),
      });
      const wedgedStaleRes = inspectListenerLiveness("worker-wedged-stale", {
        baseDir: testRoot,
        nowMs: now,
        staleThresholdMs: 10000,
      });
      expect(wedgedStaleRes.status).toBe("wedged");
      expect(wedgedStaleRes.isWedged).toBe(true);
      expect(
        isListenerWedged("worker-wedged-stale", {
          baseDir: testRoot,
          nowMs: now,
          staleThresholdMs: 10000,
        }),
      ).toBe(true);

      recordListenerHeartbeat("worker-wedged-stuck", {
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now).toISOString(),
        lastDeliveredTimestamp: new Date(now - 40000).toISOString(),
      });
      const wedgedStuckRes = inspectListenerLiveness("worker-wedged-stuck", {
        baseDir: testRoot,
        nowMs: now,
        unreadCount: 2,
        deliveryThresholdMs: 30000,
      });
      expect(wedgedStuckRes.status).toBe("wedged");
      expect(wedgedStuckRes.isWedged).toBe(true);

      recordListenerHeartbeat("worker-stopped-test", { baseDir: testRoot, pid: process.pid });
      recordListenerStopped("worker-stopped-test", testRoot, "graceful_exit");
      const stoppedHeartbeat = readListenerHeartbeat("worker-stopped-test", testRoot);
      expect(stoppedHeartbeat?.status).toBe("stopped");
      const stoppedRes = inspectListenerLiveness("worker-stopped-test", { baseDir: testRoot });
      expect(stoppedRes.status).toBe("stopped");
      expect(stoppedRes.isStopped).toBe(true);
      expect(stoppedRes.isRunning).toBe(false);
      expect(isListenerStopped("worker-stopped-test", { baseDir: testRoot })).toBe(true);
      expect(isListenerAlive("worker-stopped-test", { baseDir: testRoot })).toBe(false);

      recordListenerHeartbeat("worker-dead-pid", {
        baseDir: testRoot,
        pid: 99999999,
        timestamp: new Date(now).toISOString(),
      });
      const stoppedDeadPid = inspectListenerLiveness("worker-dead-pid", {
        baseDir: testRoot,
        nowMs: now,
      });
      expect(stoppedDeadPid.status).toBe("stopped");
      expect(stoppedDeadPid.isProcessAlive).toBe(false);
      expect(isListenerAlive("worker-dead-pid", { baseDir: testRoot, nowMs: now })).toBe(false);
    });
  });

  describe("Invariant 6: Symmetrical sender/receiver identity, filtered reads, and CLI boundaries", () => {
    it("msgSendCommand fails if sender has unsafe identity and cannot establish an outbox (counterfactual: if reverted, spoofed path traversal senders could pollute filesystem)", () => {
      expect(() =>
        msgSendCommand({
          to: "worker-target",
          type: "DISPATCH_TASK",
          actor: "../escaped-sender",
          "base-dir": testRoot,
        }),
      ).toThrow(HarnessError);
      expect(() =>
        msgSendCommand({
          to: "worker-target",
          type: "DISPATCH_TASK",
          actor: "",
          "base-dir": testRoot,
        }),
      ).toThrow(HarnessError);
    });

    it("msgSendCommand fails with INVALID_ARGUMENT when given an invalid message type", () => {
      let caught: unknown = null;
      try {
        msgSendCommand({
          to: "worker-target",
          type: "INVALID_UNKNOWN_TYPE",
          actor: "coord",
          "base-dir": testRoot,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught instanceof HarnessError).toBe(true);
      expect((caught as HarnessError).code).toBe("INVALID_ARGUMENT");
      expect((caught as HarnessError).message).toContain("INVALID_UNKNOWN_TYPE");
      expect((caught as HarnessError).message).toContain("Valid options:");
    });

    it("msgSendCommand accepts protocol and extended wire communication types", () => {
      const types = [
        "ACK",
        "STATUS",
        "QUESTION",
        "COMPLETE",
        "BLOCKED",
        "DIRECTIVE",
        "VERDICT_PASS",
        "VERDICT_FAIL",
        "PROTOCOL",
        "PING",
        "HANDSHAKE",
        "WAKE",
        "SOCRATIC_CHALLENGE",
      ] as const;
      for (const msgType of types) {
        const res = msgSendCommand({
          to: "worker-target",
          type: msgType,
          actor: "coord",
          "base-dir": testRoot,
        });
        expect(res.envelope.message_type).toBe(msgType);
      }
    });

    it("sweeps .olt/mailboxes/*/{inbox,outbox}.jsonl asserting every wire message_type is in VALID_MAILBOX_MESSAGE_TYPES", async () => {
      const fixtureWireTypes: readonly MailboxMessageType[] = [
        "DISPATCH_TASK",
        "HANDOFF_RECEIPT",
        "VALIDATION_REQUEST",
        "VALIDATION_VERDICT",
        "COGNITIVE_PUSHBACK",
        "PULSE_HEARTBEAT",
        "DEFECT_ESCALATION",
        "SYSTEM_ALERT",
        "ACK",
        "STATUS",
        "QUESTION",
        "COMPLETE",
        "BLOCKED",
        "DIRECTIVE",
        "VERDICT_PASS",
        "VERDICT_FAIL",
        "PROTOCOL",
        "PING",
        "HANDSHAKE",
        "WAKE",
        "SOCRATIC_CHALLENGE",
      ];
      for (const wireType of fixtureWireTypes) {
        expect(VALID_MAILBOX_MESSAGE_TYPES[wireType]).toBe(true);
      }
      const repoRoot = resolve(import.meta.dir, "../../..");
      const matchedFiles = Array.from(
        new Bun.Glob(".olt/mailboxes/*/{inbox,outbox}.jsonl").scanSync({ cwd: repoRoot }),
      );
      if (matchedFiles.length > 0) {
        const wireTypes = new Set<string>();
        for (const relPath of matchedFiles) {
          const content = await Bun.file(join(repoRoot, relPath)).text();
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (trimmed) {
              const parsed = JSON.parse(trimmed) as { message_type?: string };
              if (typeof parsed.message_type === "string") wireTypes.add(parsed.message_type);
            }
          }
        }
        for (const wireType of wireTypes) {
          expect(VALID_MAILBOX_MESSAGE_TYPES[wireType as MailboxMessageType]).toBe(true);
        }
      }
    });

    it("msgRecv with --type filter does not advance cursor past other unread message types (Lane 8) (counterfactual: if reverted, filtered read would skip or advance past intervening messages)", async () => {
      const recipient = "worker-filtered-lane8";
      const paths = resolveMailboxPaths(recipient, testRoot);
      ensureMailboxDirectories(paths);

      msgSendCommand({
        to: recipient,
        type: "DISPATCH_TASK",
        actor: "coord",
        "base-dir": testRoot,
      });
      msgSendCommand({ to: recipient, type: "SYSTEM_ALERT", actor: "coord", "base-dir": testRoot });

      const filteredRecv = await msgRecvCommand({
        actor: recipient,
        type: "SYSTEM_ALERT",
        "base-dir": testRoot,
        "no-advance-cursor": true,
      });
      expect(filteredRecv.totalReceipts).toBe(1);
      expect(filteredRecv.receipts[0]?.message_type).toBe("SYSTEM_ALERT");
      expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(0);

      const remainingUnread = await msgRecvCommand({
        actor: recipient,
        "base-dir": testRoot,
        "no-advance-cursor": true,
      });
      expect(remainingUnread.totalReceipts).toBe(2);
      expect(remainingUnread.receipts.map((r) => r.message_type)).toEqual([
        "DISPATCH_TASK",
        "SYSTEM_ALERT",
      ]);
    });

    it("msgListCommand --actor filters target mailbox without spoofing error and CLI execute enforces recognized flags (Lane 9/10) (counterfactual: if reverted, actor filter would be rejected or invalid flags accepted)", async () => {
      const sender = "worker-sender-symm";
      const target = "worker-target-symm";

      const sendRes = msgSendCommand({
        to: target,
        type: "PULSE_HEARTBEAT",
        actor: sender,
        "base-dir": testRoot,
      });
      expect(sendRes.envelope.sender_id).toBe(sender);
      expect(sendRes.envelope.recipient_id).toBe(target);

      const targetList = msgListCommand({ actor: target, "base-dir": testRoot });
      expect(targetList.totalMailboxes).toBe(1);
      expect(targetList.mailboxes[0]?.agentId).toBe(target);
      expect(targetList.mailboxes[0]?.inboxCount).toBe(1);

      const senderList = msgListCommand({ actor: sender, "base-dir": testRoot });
      expect(senderList.totalMailboxes).toBe(1);
      expect(senderList.mailboxes[0]?.agentId).toBe(sender);
      expect(senderList.mailboxes[0]?.outboxCount).toBe(1);

      await expect(
        execute(["msg:send", "--to", target, "--type", "SYSTEM_ALERT", "--base-dir", testRoot]),
      ).rejects.toThrow();

      const cliResult = (await execute([
        "msg:send",
        "--to",
        target,
        "--type",
        "SYSTEM_ALERT",
        "--actor",
        sender,
        "--base-dir",
        testRoot,
        "--body",
        "cli-test",
      ])) as { id: string };
      expect(typeof cliResult.id).toBe("string");

      await expect(
        execute([
          "msg:send",
          "--to",
          target,
          "--type",
          "SYSTEM_ALERT",
          "--actor",
          sender,
          "--base-dir",
          testRoot,
          "--unrecognized-flag-xyz",
          "bad",
        ]),
      ).rejects.toThrow();
    });
  });
});
