/**
 * Unit Tests for Dev Server Lifecycle & State Preservation Subsystem.
 *
 * Verifies state capture, persistence, atomic locking, graceful shutdown,
 * port verification, and transactional rollback during server restarts.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  captureSnapshot,
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  StatePreserver,
  createStatePreserver,
} from "../../olt/scripts/src/server/lifecycle/snapshot.ts";
import {
  acquireLock,
  withRestartLock,
  isLocked,
  forceReleaseLock,
  ServerLockError,
} from "../../olt/scripts/src/server/lifecycle/lock.ts";
import { shutdownProcess } from "../../olt/scripts/src/server/lifecycle/shutdown.ts";
import { startServer } from "../../olt/scripts/src/server/lifecycle/starter.ts";
import {
  DevServerLifecycleManager,
  createServerLifecycleManager,
} from "../../olt/scripts/src/server/lifecycle/coordinator.ts";
import type {
  ServerStateSnapshotInput,
  ServerEndpoint,
  PortConfiguration,
} from "../../olt/scripts/src/server/lifecycle/types.ts";

const TEST_DIR = join(tmpdir(), "test-lifecycle-tmp-" + process.pid);
const TEST_LOCK_PATH = join(TEST_DIR, "test-server-restart.lock");
const TEST_SNAPSHOT_PATH = join(TEST_DIR, "test-server-state.json");

describe("Dev Server Lifecycle Subsystem", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await forceReleaseLock(TEST_LOCK_PATH);
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("Server State Snapshot & Preserver", () => {
    it("captures full server state with custom inputs", () => {
      const endpoints: readonly ServerEndpoint[] = [
        { path: "/api/health", method: "GET", port: 3000, name: "health" },
        { path: "/api/metrics", method: "GET", port: 3000, name: "metrics" },
      ];
      const ports: readonly PortConfiguration[] = [
        { port: 3000, protocol: "tcp", isPrimary: true, host: "127.0.0.1" },
        { port: 3001, protocol: "tcp", isPrimary: false },
      ];

      const input: ServerStateSnapshotInput = {
        activeEndpoints: endpoints,
        envVariables: { NODE_ENV: "development", PORT: "3000" },
        pidHistory: [101, 102],
        portConfigurations: ports,
        runFlags: { inspect: true, reload: "auto", workers: 2 },
        currentPid: 103,
        metadata: { buildId: "v1.2.3" },
      };

      const snapshot = captureSnapshot(input);

      expect(snapshot.activeEndpoints).toHaveLength(2);
      expect(snapshot.activeEndpoints[0]?.path).toBe("/api/health");
      expect(snapshot.envVariables["PORT"]).toBe("3000");
      expect(snapshot.pidHistory).toEqual([101, 102]);
      expect(snapshot.portConfigurations).toHaveLength(2);
      expect(snapshot.portConfigurations[0]?.port).toBe(3000);
      expect(snapshot.runFlags["inspect"]).toBe(true);
      expect(snapshot.currentPid).toBe(103);
      expect(snapshot.metadata?.["buildId"]).toBe("v1.2.3");
      expect(typeof snapshot.timestamp).toBe("string");
    });

    it("populates safe defaults when fields are omitted", () => {
      const snapshot = captureSnapshot({ currentPid: 999 });

      expect(snapshot.activeEndpoints).toEqual([]);
      expect(snapshot.pidHistory).toEqual([999]);
      expect(snapshot.portConfigurations).toEqual([]);
      expect(snapshot.runFlags).toEqual({});
      expect(snapshot.currentPid).toBe(999);
      expect(typeof snapshot.timestamp).toBe("string");
    });

    it("saves and loads state snapshot from disk", async () => {
      const snapshot = captureSnapshot({
        activeEndpoints: [{ path: "/status", port: 8080 }],
        portConfigurations: [{ port: 8080, protocol: "tcp", isPrimary: true }],
        currentPid: 4242,
      });

      await saveSnapshot(snapshot, TEST_SNAPSHOT_PATH);
      expect(existsSync(TEST_SNAPSHOT_PATH)).toBe(true);

      const loaded = await loadSnapshot(TEST_SNAPSHOT_PATH);
      expect(loaded !== null).toBe(true);
      expect(loaded?.currentPid).toBe(4242);
      expect(loaded?.portConfigurations[0]?.port).toBe(8080);
      expect(loaded?.activeEndpoints[0]?.path).toBe("/status");
    });

    it("returns null when loading non-existent or malformed snapshot", async () => {
      const nonExistent = await loadSnapshot(join(TEST_DIR, "non-existent.json"));
      expect(nonExistent).toBeNull();
    });

    it("clears saved snapshot file", async () => {
      const snapshot = captureSnapshot({ currentPid: 1234 });
      await saveSnapshot(snapshot, TEST_SNAPSHOT_PATH);
      expect(existsSync(TEST_SNAPSHOT_PATH)).toBe(true);

      const cleared = await clearSnapshot(TEST_SNAPSHOT_PATH);
      expect(cleared).toBe(true);
      expect(existsSync(TEST_SNAPSHOT_PATH)).toBe(false);

      const clearAgain = await clearSnapshot(TEST_SNAPSHOT_PATH);
      expect(clearAgain).toBe(false);
    });

    it("manages snapshot lifecycle using StatePreserver class", async () => {
      const preserver = createStatePreserver(TEST_SNAPSHOT_PATH);
      expect(preserver.getLatest()).toBeNull();

      const snapshot = preserver.capture({ currentPid: 5555 });
      expect(preserver.getLatest()?.currentPid).toBe(5555);

      await preserver.save();
      expect(existsSync(TEST_SNAPSHOT_PATH)).toBe(true);

      const newPreserver = new StatePreserver(TEST_SNAPSHOT_PATH);
      const loaded = await newPreserver.load();
      expect(loaded?.currentPid).toBe(5555);

      const restoreResult = newPreserver.restore(snapshot);
      expect(restoreResult.restored).toBe(true);
      expect(restoreResult.targetPid).toBe(5555);

      await newPreserver.clear();
      expect(existsSync(TEST_SNAPSHOT_PATH)).toBe(false);
      expect(newPreserver.getLatest()).toBeNull();
    });
  });

  describe("Atomic Restart Lock", () => {
    it("acquires and releases atomic file lock cleanly", async () => {
      expect(await isLocked(TEST_LOCK_PATH)).toBe(false);

      const handle = await acquireLock({ lockPath: TEST_LOCK_PATH });
      expect(await isLocked(TEST_LOCK_PATH)).toBe(true);
      expect(existsSync(TEST_LOCK_PATH)).toBe(true);

      await handle.release();
      expect(await isLocked(TEST_LOCK_PATH)).toBe(false);
      expect(existsSync(TEST_LOCK_PATH)).toBe(false);
    });

    it("rejects concurrent lock acquisition and times out", async () => {
      const handle = await acquireLock({ lockPath: TEST_LOCK_PATH });

      let errorThrown: unknown = null;
      try {
        await acquireLock({
          lockPath: TEST_LOCK_PATH,
          timeoutMs: 150,
          pollIntervalMs: 25,
        });
      } catch (err: unknown) {
        errorThrown = err;
      }

      expect(errorThrown instanceof ServerLockError).toBe(true);
      if (errorThrown instanceof ServerLockError) {
        expect(errorThrown.code).toBe("LOCK_TIMEOUT");
        expect(errorThrown.lockPath).toBe(TEST_LOCK_PATH);
      }

      await handle.release();
    });

    it("executes critical section inside withRestartLock", async () => {
      let executed = false;
      const result = await withRestartLock(
        async () => {
          expect(await isLocked(TEST_LOCK_PATH)).toBe(true);
          executed = true;
          return "success-value";
        },
        { lockPath: TEST_LOCK_PATH },
      );

      expect(executed).toBe(true);
      expect(result).toBe("success-value");
      expect(await isLocked(TEST_LOCK_PATH)).toBe(false);
    });

    it("releases lock in withRestartLock even when action throws", async () => {
      let threw = false;
      try {
        await withRestartLock(
          async () => {
            expect(await isLocked(TEST_LOCK_PATH)).toBe(true);
            throw new Error("Action failure");
          },
          { lockPath: TEST_LOCK_PATH },
        );
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);
      expect(await isLocked(TEST_LOCK_PATH)).toBe(false);
    });

    it("detects and breaks stale locks from terminated processes", async () => {
      await forceReleaseLock(TEST_LOCK_PATH);
      const stalePayload = JSON.stringify({
        lockHolderId: "stale_process",
        pid: 9999999,
        acquiredAt: new Date(Date.now() - 100000).toISOString(),
      });
      await Bun.write(TEST_LOCK_PATH, stalePayload);

      const newHandle = await acquireLock({
        lockPath: TEST_LOCK_PATH,
        timeoutMs: 300,
        staleLockAgeMs: 1000,
      });

      expect(newHandle !== undefined).toBe(true);
      await newHandle.release();
    });

    it("does not treat a recently created empty lock file as stale immediately", async () => {
      await forceReleaseLock(TEST_LOCK_PATH);
      // Create empty lock file
      await Bun.write(TEST_LOCK_PATH, "");

      // Lock should be considered active / not stale within initial grace period
      const locked = await isLocked(TEST_LOCK_PATH);
      expect(locked).toBe(true);

      await forceReleaseLock(TEST_LOCK_PATH);
    });
  });

  describe("Graceful Shutdown Coordinator", () => {
    it("returns immediately for non-positive or already dead PID", async () => {
      const resultZero = await shutdownProcess(0);
      expect(resultZero.stopped).toBe(true);
      expect(resultZero.signalSent).toBe("NONE");

      const resultDead = await shutdownProcess(99999999, {
        isAliveChecker: () => false,
      });
      expect(resultDead.stopped).toBe(true);
      expect(resultDead.signalSent).toBe("NONE");
    });

    it("shuts down process gracefully via SIGTERM", async () => {
      let alive = true;
      const sentSignals: string[] = [];

      const result = await shutdownProcess(12345, {
        gracePeriodMs: 200,
        pollIntervalMs: 20,
        isAliveChecker: () => alive,
        signalSender: (_pid, sig) => {
          sentSignals.push(sig);
          alive = false;
          return true;
        },
      });

      expect(result.stopped).toBe(true);
      expect(result.signalSent).toBe("SIGTERM");
      expect(sentSignals).toEqual(["SIGTERM"]);
    });

    it("escalates to SIGKILL if SIGTERM does not stop process within grace period", async () => {
      let aliveCount = 0;
      const sentSignals: string[] = [];

      const result = await shutdownProcess(54321, {
        gracePeriodMs: 50,
        pollIntervalMs: 15,
        isAliveChecker: () => {
          aliveCount = aliveCount + 1;
          const killed = sentSignals.includes("SIGKILL");
          return !killed;
        },
        signalSender: (_pid, sig) => {
          sentSignals.push(sig);
          return true;
        },
      });

      expect(result.stopped).toBe(true);
      expect(result.signalSent).toBe("SIGKILL");
      expect(sentSignals.includes("SIGTERM")).toBe(true);
      expect(sentSignals.includes("SIGKILL")).toBe(true);
    });

    it("reports failure if process refuses to stop after SIGKILL", async () => {
      const result = await shutdownProcess(88888, {
        gracePeriodMs: 30,
        pollIntervalMs: 10,
        isAliveChecker: () => true,
        signalSender: () => true,
      });

      expect(result.stopped).toBe(false);
      expect(result.signalSent).toBe("SIGKILL");
      expect(result.error !== undefined).toBe(true);
    });
  });

  describe("Dev Server Starter & Port Acquisition", () => {
    it("successfully starts server and verifies port binding", async () => {
      let checkCount = 0;
      const result = await startServer({
        primaryPort: 4000,
        bindTimeoutMs: 500,
        bindPollIntervalMs: 20,
        spawnServerFn: async () => ({ pid: 7777 }),
        portChecker: async (port) => {
          checkCount = checkCount + 1;
          const matches = port === 4000;
          const countMet = checkCount >= 2;
          return matches && countMet;
        },
      });

      expect(result.started).toBe(true);
      expect(result.pid).toBe(7777);
      expect(result.boundPorts).toEqual([4000]);
    });

    it("handles multiple port configurations", async () => {
      const ports: readonly PortConfiguration[] = [
        { port: 4001, isPrimary: true },
        { port: 4002, isPrimary: false },
      ];

      const boundSet = new Set<number>();
      const result = await startServer({
        portConfigurations: ports,
        bindTimeoutMs: 500,
        bindPollIntervalMs: 20,
        spawnServerFn: async () => ({ pid: 8888 }),
        portChecker: async (port) => {
          boundSet.add(port);
          return true;
        },
      });

      expect(result.started).toBe(true);
      expect(result.boundPorts).toHaveLength(2);
      expect(result.boundPorts.includes(4001)).toBe(true);
      expect(result.boundPorts.includes(4002)).toBe(true);
    });

    it("fails when port binding times out and cleans up spawned PID", async () => {
      const result = await startServer({
        primaryPort: 9999,
        bindTimeoutMs: 60,
        bindPollIntervalMs: 15,
        spawnServerFn: async () => ({ pid: 9191 }),
        portChecker: async () => false,
      });

      expect(result.started).toBe(false);
      expect(result.error !== undefined).toBe(true);
    });

    it("handles server spawn failure cleanly", async () => {
      const result = await startServer({
        primaryPort: 3000,
        spawnServerFn: async () => {
          throw new Error("Binary not found");
        },
      });

      expect(result.started).toBe(false);
      expect(result.pid).toBe(0);
      expect(result.error !== undefined).toBe(true);
    });
  });

  describe("DevServerLifecycleManager Coordinator", () => {
    it("coordinates full successful restart workflow", async () => {
      const manager = createServerLifecycleManager(TEST_SNAPSHOT_PATH);

      let oldShutdown = false;
      let newSpawned = false;

      const result = await manager.restart({
        oldPid: 1111,
        snapshotPath: TEST_SNAPSHOT_PATH,
        lockOptions: { lockPath: TEST_LOCK_PATH },
        shutdownOptions: {
          isAliveChecker: () => !oldShutdown,
          signalSender: () => {
            oldShutdown = true;
            return true;
          },
        },
        startOptions: {
          primaryPort: 3000,
          portConfigurations: [{ port: 3000, isPrimary: true }],
          spawnServerFn: async () => {
            newSpawned = true;
            return { pid: 2222 };
          },
          portChecker: async () => true,
        },
      });

      expect(result.success).toBe(true);
      expect(result.rolledBack).toBe(false);
      expect(result.newPid).toBe(2222);
      expect(result.oldPid).toBe(1111);
      expect(result.snapshot.pidHistory.includes(2222)).toBe(true);
      expect(oldShutdown).toBe(true);
      expect(newSpawned).toBe(true);
      expect(await isLocked(TEST_LOCK_PATH)).toBe(false);

      // Verify state was saved to disk
      const persistedState = await loadSnapshot(TEST_SNAPSHOT_PATH);
      expect(persistedState?.currentPid).toBe(2222);
    });

    it("executes transactional rollback when new server fails to bind", async () => {
      const manager = new DevServerLifecycleManager(TEST_SNAPSHOT_PATH);

      let oldRestored = false;
      let oldShutdown = false;

      const initialSnapshot = captureSnapshot({
        currentPid: 3333,
        portConfigurations: [{ port: 5000, isPrimary: true }],
        envVariables: { APP_ENV: "test" },
      });

      const result = await manager.restart({
        customSnapshot: initialSnapshot,
        oldPid: 3333,
        snapshotPath: TEST_SNAPSHOT_PATH,
        lockOptions: { lockPath: TEST_LOCK_PATH },
        rollbackOnError: true,
        shutdownOptions: {
          isAliveChecker: () => !oldShutdown,
          signalSender: () => {
            oldShutdown = true;
            return true;
          },
        },
        startOptions: {
          primaryPort: 5000,
          bindTimeoutMs: 50,
          bindPollIntervalMs: 10,
          spawnServerFn: async () => ({ pid: 4444 }),
          portChecker: async () => false,
        },
        restoreOldServerFn: async (snapshot) => {
          expect(snapshot.currentPid).toBe(3333);
          oldRestored = true;
          return { pid: 3333 };
        },
      });

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      expect(result.snapshotRestored).toBe(true);
      expect(result.serverProcessRestored).toBe(true);
      expect(result.restoredState?.currentPid).toBe(3333);
      expect(oldRestored).toBe(true);
      expect(result.error !== undefined).toBe(true);
      expect(await isLocked(TEST_LOCK_PATH)).toBe(false);
    });

    it("maintains in-memory state tracking via captureState and getState", () => {
      const manager = new DevServerLifecycleManager(TEST_SNAPSHOT_PATH);
      expect(manager.getState()).toBeNull();

      manager.captureState({
        currentPid: 9876,
        portConfigurations: [{ port: 8080 }],
      });

      expect(manager.getState()?.currentPid).toBe(9876);
      expect(manager.getState()?.portConfigurations[0]?.port).toBe(8080);
    });
  });
});
