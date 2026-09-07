import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import {
  clearInMemoryHeartbeats,
  deleteListenerHeartbeat,
  emitListenerHeartbeat,
  getInMemoryHeartbeat,
  isValidListenerHeartbeat,
  loadListenerHeartbeat,
  readListenerHeartbeat,
  recordListenerHeartbeat,
  recordListenerStopped,
  removeListenerHeartbeat,
  resetInMemoryHeartbeats,
  setInMemoryHeartbeat,
  type ListenerHeartbeat,
} from "../../../../olt/scripts/src/communication/mailbox/liveness.ts";
import { resolveListenerHeartbeatPath } from "../../../../olt/scripts/src/communication/mailbox/mailbox-paths.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS, vfs } from "../../helpers.ts";

describe("Mailbox Liveness Heartbeat Lifecycle", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    clearInMemoryHeartbeats();
    testRoot = `/fixture/liveness-hb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    clearInMemoryHeartbeats();
    cleanupVirtualCommunicationFS();
  });

  describe("In-Memory Heartbeat Store", () => {
    it("stores, retrieves, and clears in-memory heartbeats", () => {
      const virtualPath = "virtual://liveness-suite/.olt/mailboxes/agent-a/heartbeat.json";
      const sample: ListenerHeartbeat = {
        actor: "agent-a",
        pid: 12345,
        timestamp: "2026-09-07T00:00:00.000Z",
        last_delivered_timestamp: null,
        lastDeliveredTimestamp: null,
        status: "running",
        stopped_at: null,
        stoppedAt: null,
        exit_code: null,
        exitCode: null,
        reason: null,
      };
      setInMemoryHeartbeat(virtualPath, sample);
      const retrieved = getInMemoryHeartbeat(virtualPath);
      expect(retrieved?.actor).toBe("agent-a");
      expect(retrieved?.pid).toBe(12345);
      expect(retrieved?.status).toBe("running");

      resetInMemoryHeartbeats();
      expect(getInMemoryHeartbeat(virtualPath)).toBeUndefined();
    });
  });

  describe("Heartbeat Validation", () => {
    it("validates listener heartbeat structures correctly", () => {
      const valid: unknown = { actor: "agent-b", pid: 9999, timestamp: "2026-09-07T01:00:00.000Z" };
      expect(isValidListenerHeartbeat(valid)).toBe(true);
      expect(isValidListenerHeartbeat(null)).toBe(false);
      expect(isValidListenerHeartbeat("not-an-object")).toBe(false);
      expect(isValidListenerHeartbeat({})).toBe(false);
      expect(
        isValidListenerHeartbeat({ actor: "", pid: 100, timestamp: "2026-09-07T00:00:00Z" }),
      ).toBe(false);
      expect(
        isValidListenerHeartbeat({
          actor: "agent-b",
          pid: "not-a-number",
          timestamp: "2026-09-07T00:00:00Z",
        }),
      ).toBe(false);
      expect(
        isValidListenerHeartbeat({ actor: "agent-b", pid: 100, timestamp: "invalid-iso" }),
      ).toBe(false);
      expect(
        isValidListenerHeartbeat({
          actor: "agent-b",
          pid: 100,
          timestamp: "2026-09-07T00:00:00Z",
          status: 123,
        }),
      ).toBe(false);
      expect(
        isValidListenerHeartbeat({
          actor: "agent-b",
          pid: 100,
          timestamp: "2026-09-07T00:00:00Z",
          exit_code: "bad",
        }),
      ).toBe(false);
    });
  });

  describe("Record & Read Heartbeat Lifecycle", () => {
    it("records heartbeat with string actor and reads it back faithfully", () => {
      const recorded = recordListenerHeartbeat("agent-recorder", { baseDir: testRoot });
      expect(recorded.actor).toBe("agent-recorder");
      expect(recorded.status).toBe("running");
      expect(recorded.pid).toBe(process.pid);
      expect(recorded.stopped_at).toBeNull();

      const readBack = readListenerHeartbeat("agent-recorder", testRoot);
      expect(readBack?.actor).toBe("agent-recorder");
      expect(readBack?.status).toBe("running");
      expect(readBack?.pid).toBe(process.pid);

      const loaded = loadListenerHeartbeat("agent-recorder", testRoot);
      expect(loaded?.actor).toBe("agent-recorder");
    });

    it("records heartbeat with options object including lastDeliveredTimestamp and emits via alias", () => {
      const ts = "2026-09-07T02:00:00.000Z";
      const emitted = emitListenerHeartbeat({
        actor: "agent-opts",
        baseDir: testRoot,
        pid: process.pid,
        timestamp: ts,
        lastDeliveredTimestamp: ts,
        status: "running",
      });
      expect(emitted.actor).toBe("agent-opts");
      expect(emitted.timestamp).toBe(ts);
      expect(emitted.last_delivered_timestamp).toBe(ts);

      const readBack = readListenerHeartbeat("agent-opts", testRoot);
      expect(readBack?.lastDeliveredTimestamp).toBe(ts);
    });

    it("throws INVALID_ARGUMENT when lastDeliveredTimestamp is malformed", () => {
      let errorThrown: unknown = null;
      try {
        recordListenerHeartbeat({
          actor: "agent-bad-date",
          baseDir: testRoot,
          lastDeliveredTimestamp: "invalid-timestamp-string",
        });
      } catch (err) {
        errorThrown = err;
      }
      expect(errorThrown instanceof HarnessError).toBe(true);
      expect((errorThrown as HarnessError).code).toBe("INVALID_ARGUMENT");
    });

    it("records and reads heartbeats on virtual mailbox paths without touching disk", () => {
      const virtRoot = "virtual://liveness-mem";
      const virtHeartbeat = recordListenerHeartbeat("agent-virt", { baseDir: virtRoot, pid: 42 });
      expect(virtHeartbeat.actor).toBe("agent-virt");
      expect(virtHeartbeat.pid).toBe(42);

      const readVirt = readListenerHeartbeat("agent-virt", virtRoot);
      expect(readVirt?.actor).toBe("agent-virt");
      expect(readVirt?.pid).toBe(42);

      deleteListenerHeartbeat("agent-virt", virtRoot);
      expect(readListenerHeartbeat("agent-virt", virtRoot)).toBeNull();
    });

    it("returns null when reading non-existent or corrupted heartbeat files", () => {
      expect(readListenerHeartbeat("agent-missing", testRoot)).toBeNull();

      const hbPath = resolveListenerHeartbeatPath("agent-corrupt", testRoot);
      vfs.mkdirSync(dirname(hbPath), { recursive: true });
      vfs.writeFileSync(hbPath, "not-valid-json{{}");
      expect(readListenerHeartbeat("agent-corrupt", testRoot)).toBeNull();

      vfs.writeFileSync(hbPath, JSON.stringify({ actor: "agent-corrupt" }));
      expect(readListenerHeartbeat("agent-corrupt", testRoot)).toBeNull();
    });

    it("reads heartbeat with camelCase schema keys", () => {
      const hbPath = resolveListenerHeartbeatPath("agent-camel", testRoot);
      vfs.mkdirSync(dirname(hbPath), { recursive: true });
      vfs.writeFileSync(
        hbPath,
        JSON.stringify({
          actor: "agent-camel",
          pid: process.pid,
          timestamp: "2026-09-07T00:00:00.000Z",
          lastDeliveredTimestamp: "2026-09-07T00:01:00.000Z",
          stoppedAt: "2026-09-07T00:02:00.000Z",
          exitCode: 42,
          status: "stopped",
          reason: "graceful_camel_exit",
        }),
      );
      const parsed = readListenerHeartbeat("agent-camel", testRoot);
      expect(parsed?.actor).toBe("agent-camel");
      expect(parsed?.last_delivered_timestamp).toBe("2026-09-07T00:01:00.000Z");
      expect(parsed?.stopped_at).toBe("2026-09-07T00:02:00.000Z");
      expect(parsed?.exit_code).toBe(42);
      expect(parsed?.reason).toBe("graceful_camel_exit");
    });
  });

  describe("Stop & Delete Heartbeats", () => {
    it("records stopped state with string arguments", () => {
      recordListenerHeartbeat("agent-stopper", { baseDir: testRoot });
      const stopped = recordListenerStopped("agent-stopper", testRoot, "worker_completed", 0);
      expect(stopped.status).toBe("stopped");
      expect(stopped.reason).toBe("worker_completed");
      expect(stopped.exit_code).toBe(0);

      const readBack = readListenerHeartbeat("agent-stopper", testRoot);
      expect(readBack?.status).toBe("stopped");
      expect(readBack?.reason).toBe("worker_completed");
    });

    it("records stopped state when reasonOrCode is a number", () => {
      recordListenerHeartbeat("agent-code-num", { baseDir: testRoot });
      const stopped = recordListenerStopped("agent-code-num", testRoot, 137);
      expect(stopped.status).toBe("stopped");
      expect(stopped.exit_code).toBe(137);
      expect(stopped.reason).toBe("Listener stopped");
    });

    it("records stopped state via options object", () => {
      recordListenerHeartbeat("agent-obj-stop", { baseDir: testRoot });
      const stopped = recordListenerStopped({
        actor: "agent-obj-stop",
        baseDir: testRoot,
        reason: "maintenance",
        exit_code: 1,
      });
      expect(stopped.status).toBe("stopped");
      expect(stopped.reason).toBe("maintenance");
      expect(stopped.exit_code).toBe(1);
    });

    it("removes heartbeat by recording listener_exit", () => {
      recordListenerHeartbeat("agent-remover", { baseDir: testRoot });
      removeListenerHeartbeat("agent-remover", testRoot);
      const readBack = readListenerHeartbeat("agent-remover", testRoot);
      expect(readBack?.status).toBe("stopped");
      expect(readBack?.reason).toBe("listener_exit");
    });

    it("deletes heartbeat completely from memory and filesystem", () => {
      recordListenerHeartbeat("agent-deleter", { baseDir: testRoot });
      deleteListenerHeartbeat("agent-deleter", testRoot);
      expect(readListenerHeartbeat("agent-deleter", testRoot)).toBeNull();
    });
  });
});
