import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  captureSnapshot,
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  StatePreserver,
  createStatePreserver,
} from "../../../olt/scripts/src/server/lifecycle/snapshot.ts";
import {
  acquireLock,
  withRestartLock,
  isLocked,
  forceReleaseLock,
  ServerLockError,
} from "../../../olt/scripts/src/server/lifecycle/lock.ts";
import type {
  ServerStateSnapshotInput,
  ServerEndpoint,
  PortConfiguration,
} from "../../../olt/scripts/src/server/lifecycle/types.ts";
import { scratchRoot } from "../../shared/fixtures/scratch-root.ts";

describe("Dev Server Lifecycle Subsystem - State & Lock Daemon", () => {
  const roots: string[] = [];
  let testDir: string;
  let testLockPath: string;
  let testSnapshotPath: string;

  beforeEach(() => {
    testDir = scratchRoot(import.meta.path, "server-lifecycle-daemon");
    roots.push(testDir);
    testLockPath = join(testDir, "test-server-restart.lock");
    testSnapshotPath = join(testDir, "test-server-state.json");
  });

  afterEach(async () => {
    await forceReleaseLock(testLockPath);
    for (const root of roots.splice(0)) {
      if (existsSync(root)) {
        rmSync(root, { recursive: true, force: true });
      }
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

      await saveSnapshot(snapshot, testSnapshotPath);
      expect(existsSync(testSnapshotPath)).toBe(true);

      const loaded = await loadSnapshot(testSnapshotPath);
      expect(loaded !== null).toBe(true);
      expect(loaded?.currentPid).toBe(4242);
      expect(loaded?.portConfigurations[0]?.port).toBe(8080);
      expect(loaded?.activeEndpoints[0]?.path).toBe("/status");
    });

    it("returns null when loading non-existent or malformed snapshot", async () => {
      const nonExistent = await loadSnapshot(join(testDir, "non-existent.json"));
      expect(nonExistent).toBeNull();
    });

    it("clears saved snapshot file", async () => {
      const snapshot = captureSnapshot({ currentPid: 1234 });
      await saveSnapshot(snapshot, testSnapshotPath);
      expect(existsSync(testSnapshotPath)).toBe(true);

      const cleared = await clearSnapshot(testSnapshotPath);
      expect(cleared).toBe(true);
      expect(existsSync(testSnapshotPath)).toBe(false);

      const clearAgain = await clearSnapshot(testSnapshotPath);
      expect(clearAgain).toBe(false);
    });

    it("manages snapshot lifecycle using StatePreserver class", async () => {
      const preserver = createStatePreserver(testSnapshotPath);
      expect(preserver.getLatest()).toBeNull();

      const snapshot = preserver.capture({ currentPid: 5555 });
      expect(preserver.getLatest()?.currentPid).toBe(5555);

      await preserver.save();
      expect(existsSync(testSnapshotPath)).toBe(true);

      const newPreserver = new StatePreserver(testSnapshotPath);
      const loaded = await newPreserver.load();
      expect(loaded?.currentPid).toBe(5555);

      const restoreResult = newPreserver.restore(snapshot);
      expect(restoreResult.restored).toBe(true);
      expect(restoreResult.targetPid).toBe(5555);

      await newPreserver.clear();
      expect(existsSync(testSnapshotPath)).toBe(false);
      expect(newPreserver.getLatest()).toBeNull();
    });
  });

  describe("Atomic Restart Lock", () => {
    it("acquires and releases atomic file lock cleanly", async () => {
      expect(await isLocked(testLockPath)).toBe(false);

      const handle = await acquireLock({ lockPath: testLockPath });
      expect(await isLocked(testLockPath)).toBe(true);
      expect(existsSync(testLockPath)).toBe(true);

      await handle.release();
      expect(await isLocked(testLockPath)).toBe(false);
      expect(existsSync(testLockPath)).toBe(false);
    });

    it("rejects concurrent lock acquisition and times out", async () => {
      const handle = await acquireLock({ lockPath: testLockPath });

      let errorThrown: unknown = null;
      try {
        await acquireLock({
          lockPath: testLockPath,
          timeoutMs: 150,
          pollIntervalMs: 25,
        });
      } catch (err: unknown) {
        errorThrown = err;
      }

      expect(errorThrown instanceof ServerLockError).toBe(true);
      if (errorThrown instanceof ServerLockError) {
        expect(errorThrown.code).toBe("LOCK_TIMEOUT");
        expect(errorThrown.lockPath).toBe(testLockPath);
      }

      await handle.release();
    });

    it("executes critical section inside withRestartLock", async () => {
      let executed = false;
      const result = await withRestartLock(
        async () => {
          expect(await isLocked(testLockPath)).toBe(true);
          executed = true;
          return "success-value";
        },
        { lockPath: testLockPath },
      );

      expect(executed).toBe(true);
      expect(result).toBe("success-value");
      expect(await isLocked(testLockPath)).toBe(false);
    });

    it("releases lock in withRestartLock even when action throws", async () => {
      let threw = false;
      try {
        await withRestartLock(
          async () => {
            expect(await isLocked(testLockPath)).toBe(true);
            throw new Error("Action failure");
          },
          { lockPath: testLockPath },
        );
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);
      expect(await isLocked(testLockPath)).toBe(false);
    });

    it("detects and breaks stale locks from terminated processes", async () => {
      await forceReleaseLock(testLockPath);
      const stalePayload = JSON.stringify({
        lockHolderId: "stale_process",
        pid: 9999999,
        acquiredAt: new Date(Date.now() - 100000).toISOString(),
      });
      await Bun.write(testLockPath, stalePayload);

      const newHandle = await acquireLock({
        lockPath: testLockPath,
        timeoutMs: 300,
        staleLockAgeMs: 1000,
      });

      expect(newHandle !== undefined).toBe(true);
      await newHandle.release();
    });

    it("does not treat a recently created empty lock file as stale immediately", async () => {
      await forceReleaseLock(testLockPath);
      await Bun.write(testLockPath, "");

      const locked = await isLocked(testLockPath);
      expect(locked).toBe(true);

      await forceReleaseLock(testLockPath);
    });
  });
});
