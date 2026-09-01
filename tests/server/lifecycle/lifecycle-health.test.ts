import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import {
  captureSnapshot,
  loadSnapshot,
} from "../../../olt/scripts/src/server/lifecycle/snapshot.ts";
import { forceReleaseLock, isLocked } from "../../../olt/scripts/src/server/lifecycle/lock.ts";
import { shutdownProcess } from "../../../olt/scripts/src/server/lifecycle/shutdown.ts";
import { startServer } from "../../../olt/scripts/src/server/lifecycle/starter.ts";
import {
  DevServerLifecycleManager,
  createServerLifecycleManager,
} from "../../../olt/scripts/src/server/lifecycle/coordinator.ts";
import type { PortConfiguration } from "../../../olt/scripts/src/server/lifecycle/types.ts";
import { cleanupVirtualServerFS, scratchRoot, setupVirtualServerFS } from "../fixture.ts";

describe("Dev Server Lifecycle Subsystem - Health & Shutdown Coordinator", () => {
  let testDir: string;
  let testLockPath: string;
  let testSnapshotPath: string;

  beforeEach(() => {
    setupVirtualServerFS();
    testDir = scratchRoot("server-lifecycle-health", "health");
    testLockPath = join(testDir, "test-server-restart.lock");
    testSnapshotPath = join(testDir, "test-server-state.json");
  });

  afterEach(async () => {
    await forceReleaseLock(testLockPath);
    cleanupVirtualServerFS();
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
          aliveCount++;
          return !sentSignals.includes("SIGKILL");
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
          checkCount++;
          return port === 4000 && checkCount >= 2;
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
      const manager = createServerLifecycleManager(testSnapshotPath);
      let oldShutdown = false;
      let newSpawned = false;

      const result = await manager.restart({
        oldPid: 1111,
        snapshotPath: testSnapshotPath,
        lockOptions: { lockPath: testLockPath },
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
      expect(await isLocked(testLockPath)).toBe(false);

      const persistedState = await loadSnapshot(testSnapshotPath);
      expect(persistedState?.currentPid).toBe(2222);
    });

    it("executes transactional rollback when new server fails to bind", async () => {
      const manager = new DevServerLifecycleManager(testSnapshotPath);
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
        snapshotPath: testSnapshotPath,
        lockOptions: { lockPath: testLockPath },
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
      expect(await isLocked(testLockPath)).toBe(false);
    });

    it("maintains in-memory state tracking via captureState and getState", () => {
      const manager = new DevServerLifecycleManager(testSnapshotPath);
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
