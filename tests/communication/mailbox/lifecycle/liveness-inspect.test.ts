import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  DEFAULT_DELIVERY_TIMEOUT_MS,
  DEFAULT_LISTENER_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_LISTENER_STALE_THRESHOLD_MS,
  clearInMemoryHeartbeats,
  getListenerLiveness,
  getListenerPid,
  getListenerStatus,
  hasListenerNoMessages,
  inspectListenerLiveness,
  isListenerAlive,
  isListenerDelivering,
  isListenerNoMessages,
  isListenerProcessAlive,
  isListenerRunning,
  isListenerStopped,
  isListenerWedged,
  recordListenerHeartbeat,
  recordListenerStopped,
} from "../../../../olt/scripts/src/communication/mailbox/liveness.ts";
import {
  ensureMailboxDirectories,
  resolveMailboxPaths,
} from "../../../../olt/scripts/src/communication/mailbox/mailbox-paths.ts";
import { appendMailboxMessage } from "../../../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import { advanceMailboxCursor } from "../../../../olt/scripts/src/communication/mailbox/cursor-tracker.ts";
import { createSignedEnvelope } from "../../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS, vfs } from "../../helpers.ts";

describe("Mailbox Liveness Inspect Engine", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    clearInMemoryHeartbeats();
    testRoot = `/fixture/liveness-insp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    clearInMemoryHeartbeats();
    cleanupVirtualCommunicationFS();
  });

  describe("inspectListenerLiveness Engine", () => {
    it("returns stopped when no heartbeat exists", () => {
      const result = inspectListenerLiveness("agent-no-hb", { baseDir: testRoot });
      expect(result.status).toBe("stopped");
      expect(result.state).toBe("STOPPED");
      expect(result.isRunning).toBe(false);
      expect(result.isStopped).toBe(true);
      expect(result.reason).toBe("No heartbeat found for actor");
    });

    it("returns stopped when heartbeat status is stopped", () => {
      recordListenerHeartbeat("agent-was-stopped", { baseDir: testRoot });
      recordListenerStopped("agent-was-stopped", testRoot, "task_done");
      const result = inspectListenerLiveness("agent-was-stopped", testRoot);
      expect(result.status).toBe("stopped");
      expect(result.isStopped).toBe(true);
      expect(result.reason).toContain("task_done");
    });

    it("returns stopped when process PID is dead", () => {
      const deadPid = 99999999;
      recordListenerHeartbeat({ actor: "agent-dead-proc", baseDir: testRoot, pid: deadPid });
      const result = inspectListenerLiveness("agent-dead-proc", { baseDir: testRoot });
      expect(result.status).toBe("stopped");
      expect(result.isProcessAlive).toBe(false);
      expect(result.reason).toContain(`Process with PID ${deadPid} is not alive`);
    });

    it("returns wedged when heartbeat age exceeds stale threshold", () => {
      const oldTime = "2026-09-01T00:00:00.000Z";
      recordListenerHeartbeat({
        actor: "agent-stale-hb",
        baseDir: testRoot,
        pid: process.pid,
        timestamp: oldTime,
      });
      const result = inspectListenerLiveness("agent-stale-hb", {
        baseDir: testRoot,
        nowMs: Date.parse("2026-09-07T00:00:00.000Z"),
        staleThresholdMs: 60000,
      });
      expect(result.status).toBe("wedged");
      expect(result.isWedged).toBe(true);
      expect(result.reason).toContain("Heartbeat stale");
    });

    it("returns no_messages when listener is alive, fresh, and has no pending messages or deliveries", () => {
      const now = Date.now();
      recordListenerHeartbeat({
        actor: "agent-idle",
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now).toISOString(),
      });
      const result = inspectListenerLiveness("agent-idle", {
        baseDir: testRoot,
        nowMs: now,
        unreadCount: 0,
      });
      expect(result.status).toBe("no_messages");
      expect(result.hasNoMessages).toBe(true);
      expect(result.isRunning).toBe(true);
      expect(result.isDelivering).toBe(false);
    });

    it("returns running_and_delivering when listener delivered recently without pending messages", () => {
      const now = Date.now();
      recordListenerHeartbeat({
        actor: "agent-delivered-recent",
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now).toISOString(),
        lastDeliveredTimestamp: new Date(now - 1000).toISOString(),
      });
      const result = inspectListenerLiveness("agent-delivered-recent", {
        baseDir: testRoot,
        nowMs: now,
        deliveryThresholdMs: 5000,
        unreadCount: 0,
      });
      expect(result.status).toBe("running_and_delivering");
      expect(result.isDelivering).toBe(true);
      expect(result.isRunning).toBe(true);
    });

    it("returns running_and_delivering when pending messages exist and recent delivery occurred", () => {
      const now = Date.now();
      recordListenerHeartbeat({
        actor: "agent-delivering-pending",
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now).toISOString(),
        lastDeliveredTimestamp: new Date(now - 500).toISOString(),
      });
      const result = inspectListenerLiveness("agent-delivering-pending", {
        baseDir: testRoot,
        nowMs: now,
        deliveryThresholdMs: 5000,
        unreadCount: 3,
      });
      expect(result.status).toBe("running_and_delivering");
      expect(result.isDelivering).toBe(true);
    });

    it("returns wedged when pending messages exist but no delivery occurred within threshold", () => {
      const now = Date.now();
      recordListenerHeartbeat({
        actor: "agent-wedged-pending",
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now).toISOString(),
        lastDeliveredTimestamp: new Date(now - 60000).toISOString(),
      });
      const result = inspectListenerLiveness("agent-wedged-pending", {
        baseDir: testRoot,
        nowMs: now,
        deliveryThresholdMs: 5000,
        unreadCount: 5,
      });
      expect(result.status).toBe("wedged");
      expect(result.isWedged).toBe(true);
      expect(result.reason).toContain("Listener is wedged: 5 pending messages exist");
    });

    it("counts pending messages from inbox and respects cursor progress", () => {
      const actor = "agent-counted";
      const paths = resolveMailboxPaths(actor, testRoot);
      ensureMailboxDirectories(paths);

      const now = Date.now();
      recordListenerHeartbeat({
        actor,
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now).toISOString(),
        lastDeliveredTimestamp: new Date(now - 1000).toISOString(),
      });

      const env1 = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "DISPATCH_TASK",
        payload: { step: 1 },
        sequence: 1,
      });
      const env2 = createSignedEnvelope({
        senderId: "coord",
        senderRole: "c",
        recipientId: actor,
        messageType: "SYSTEM_ALERT",
        payload: { step: 2 },
        sequence: 2,
      });

      appendMailboxMessage(paths.inboxPath, env1, paths.lockPath);
      appendMailboxMessage(paths.inboxPath, env2, paths.lockPath);

      const beforeAdvance = inspectListenerLiveness(actor, { baseDir: testRoot, nowMs: now });
      expect(beforeAdvance.status).toBe("running_and_delivering");

      advanceMailboxCursor(paths.cursorPath, env1, undefined, paths.lockPath);
      advanceMailboxCursor(paths.cursorPath, env2, undefined, paths.lockPath);

      recordListenerHeartbeat({
        actor,
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now + 20000).toISOString(),
        lastDeliveredTimestamp: new Date(now - 1000).toISOString(),
      });

      const afterAdvance = inspectListenerLiveness(actor, {
        baseDir: testRoot,
        nowMs: now + 20000,
        deliveryThresholdMs: 5000,
      });
      expect(afterAdvance.status).toBe("no_messages");
    });
  });

  describe("Helper Predicates and Accessors", () => {
    it("drives all boolean predicates and getter helpers", () => {
      const now = Date.now();
      recordListenerHeartbeat({
        actor: "agent-helpers",
        baseDir: testRoot,
        pid: process.pid,
        timestamp: new Date(now).toISOString(),
      });

      const target = "agent-helpers";
      const opts = { baseDir: testRoot, nowMs: now, unreadCount: 0 };

      expect(isListenerAlive(target, opts)).toBe(true);
      expect(isListenerRunning(target, opts)).toBe(true);
      expect(isListenerStopped(target, opts)).toBe(false);
      expect(isListenerWedged(target, opts)).toBe(false);
      expect(isListenerDelivering(target, opts)).toBe(false);
      expect(isListenerNoMessages(target, opts)).toBe(true);
      expect(hasListenerNoMessages(target, opts)).toBe(true);
      expect(isListenerProcessAlive(target, opts)).toBe(true);
      expect(getListenerPid(target, opts)).toBe(process.pid);
      expect(getListenerStatus(target, opts)).toBe("no_messages");
      expect(getListenerLiveness(target, opts).status).toBe("no_messages");

      expect(DEFAULT_DELIVERY_TIMEOUT_MS).toBeGreaterThan(0);
      expect(DEFAULT_LISTENER_HEARTBEAT_TIMEOUT_MS).toBeGreaterThan(0);
      expect(DEFAULT_LISTENER_STALE_THRESHOLD_MS).toBeGreaterThan(0);
    });
  });
});
