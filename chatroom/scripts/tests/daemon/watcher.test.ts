import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import {
  daemonHealthPath,
  roomLogDir,
  roomLogIndexPath,
  roomLogSegmentPath,
} from "../../src/core/index.ts";
import {
  computeChangeToken,
  createInitialHealthRecord,
  DaemonWatcher,
  hasTokenChanged,
  inspectDaemon,
  readHealthRecord,
  type DaemonWatcherPorts,
  type WatcherHandle,
  type WakeSource,
} from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

function createVirtualPorts(
  vfs: ChatVirtualFS,
  options?: {
    readonly onDirWatchCreated?: (handle: WatcherHandle) => void;
  },
): DaemonWatcherPorts {
  return {
    existsSync: (targetPath: string) => vfs.existsSync(targetPath),
    watch: (targetPath: string, _opts, listener) => {
      const virtualWatcher = vfs.watch(targetPath, (_event, filename) => {
        listener("change", filename);
      });
      const handle: WatcherHandle = {
        close: () => {
          virtualWatcher.close();
        },
        on: (_event: "error", _errListener: () => void) => {},
      };
      if (options?.onDirWatchCreated && targetPath.includes("/log")) {
        options.onDirWatchCreated(handle);
      }
      return handle;
    },
    readdirSync: (dirPath: string) => vfs.readdirSync(dirPath) as string[],
    readFileSync: (filePath: string) => vfs.readFileSync(filePath, "utf8"),
    statSync: (targetPath: string) => {
      const stat = vfs.statSync(targetPath);
      return {
        size: stat?.size ?? 0,
        ino: 1,
      };
    },
    writeAtomic: (targetPath: string, content: string) => {
      vfs.mkdirSync(dirname(targetPath), { recursive: true });
      vfs.writeFileSync(targetPath, content);
    },
    writeFileSync: (targetPath: string, content: string) => {
      vfs.writeFileSync(targetPath, content);
    },
  };
}

describe("DaemonWatcher attachment retry and unconditional polling", () => {
  it("initializes with watch_active false when room directory does not exist", () => {
    const vfs = new ChatVirtualFS();
    const ports = createVirtualPorts(vfs);
    const watcher = new DaemonWatcher("uncreated-room", { ports });
    const metrics = watcher.getMetrics();

    expect(metrics.watch_active).toBe(false);
    expect(metrics.watch_failures).toBe(0);
    expect(metrics.poll_interval_ms).toBe(750);
  });

  it("retries attachment and activates watcher when room directory is created after startup", async () => {
    const vfs = new ChatVirtualFS();
    const ports = createVirtualPorts(vfs);
    const roomId = "delayed-room";
    const watcher = new DaemonWatcher(roomId, {
      ports,
      pollIntervalMs: 25,
      retryDelayMs: 10,
    });

    const receivedWakes: WakeSource[] = [];
    watcher.start((source) => {
      receivedWakes.push(source);
    });

    const initialMetrics = watcher.getMetrics();
    expect(initialMetrics.watch_active).toBe(false);

    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));

    await new Promise((resolve) => setTimeout(resolve, 60));

    const attachedMetrics = watcher.getMetrics();
    expect(attachedMetrics.watch_active).toBe(true);
    expect(attachedMetrics.watch_failures).toBe(0);

    watcher.stop();
    const stoppedMetrics = watcher.getMetrics();
    expect(stoppedMetrics.watch_active).toBe(false);
    expect(receivedWakes.length).toBeGreaterThan(0);
  });

  it("maintains unconditional 750ms poll loop active at all times", async () => {
    const vfs = new ChatVirtualFS();
    const roomId = "poll-room";
    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));

    const ports = createVirtualPorts(vfs);
    const watcher = new DaemonWatcher(roomId, {
      ports,
      pollIntervalMs: 20,
    });

    const wakes: WakeSource[] = [];
    watcher.start((source) => {
      wakes.push(source);
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    watcher.stop();

    const metrics = watcher.getMetrics();
    expect(metrics.poll_interval_ms).toBe(20);
    expect(wakes.length).toBeGreaterThan(1);
    expect(wakes.includes("poll")).toBe(true);
  });

  it("recovers and retries attachment after watch error without modifying poll interval", async () => {
    const vfs = new ChatVirtualFS();
    const roomId = "error-recovery-room";
    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));

    const errorListeners: Array<() => void> = [];
    const ports = createVirtualPorts(vfs);
    const portsWithError: DaemonWatcherPorts = {
      ...ports,
      watch: (targetPath, opts, listener) => {
        const h = ports.watch!(targetPath, opts, listener);
        return {
          close: () => h.close(),
          on: (event: "error", errCb: () => void) => {
            if (event === "error" && targetPath.includes("/log")) {
              errorListeners.push(errCb);
            }
          },
        };
      },
    };

    const watcher = new DaemonWatcher(roomId, {
      ports: portsWithError,
      pollIntervalMs: 750,
      retryDelayMs: 15,
    });

    watcher.start(() => {});
    const initialMetrics = watcher.getMetrics();
    expect(initialMetrics.watch_active).toBe(true);
    expect(initialMetrics.watch_failures).toBe(0);
    expect(initialMetrics.poll_interval_ms).toBe(750);

    for (const listener of errorListeners) {
      listener();
    }

    const failedMetrics = watcher.getMetrics();
    expect(failedMetrics.watch_failures).toBeGreaterThan(0);
    expect(failedMetrics.poll_interval_ms).toBe(750);

    await new Promise((resolve) => setTimeout(resolve, 60));

    const recoveredMetrics = watcher.getMetrics();
    expect(recoveredMetrics.watch_active).toBe(true);
    expect(recoveredMetrics.poll_interval_ms).toBe(750);

    watcher.stop();
  });

  it("detects token change on room log append", () => {
    const vfs = new ChatVirtualFS();
    const roomId = "token-room";
    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));
    vfs.writeFileSync(roomLogSegmentPath(roomId, 0), "line1\n");

    const ports = createVirtualPorts(vfs);
    const token1 = computeChangeToken(roomId, ports);
    expect(token1.next_seq).toBe(1);
    expect(token1.head_segment_size).toBe(6);

    vfs.appendFileSync(roomLogSegmentPath(roomId, 0), "line2\n");
    const token2 = computeChangeToken(roomId, ports);
    expect(token2.head_segment_size).toBe(12);
    expect(hasTokenChanged(token1, token2)).toBe(true);
  });

  it("updates watch_active in daemon health record when watcher starts, errors, and stops", async () => {
    const vfs = new ChatVirtualFS();
    const roomId = "health-room";
    const readerId = "agent-alpha";
    const healthPath = daemonHealthPath(roomId, readerId);

    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));

    const initialHealth = createInitialHealthRecord(
      roomId,
      readerId,
      12345,
      new Date().toISOString(),
      "test-boot",
    );
    vfs.mkdirSync(dirname(healthPath), { recursive: true });
    vfs.writeFileSync(healthPath, JSON.stringify(initialHealth, null, 2));

    const errorListeners: Array<() => void> = [];
    const basePorts = createVirtualPorts(vfs);
    const ports: DaemonWatcherPorts = {
      ...basePorts,
      watch: (targetPath, opts, listener) => {
        const h = basePorts.watch!(targetPath, opts, listener);
        return {
          close: () => h.close(),
          on: (event: "error", errCb: () => void) => {
            if (event === "error" && targetPath.includes("/log")) {
              errorListeners.push(errCb);
            }
          },
        };
      },
    };

    const watcher = new DaemonWatcher(roomId, {
      reader: readerId,
      healthPath,
      ports,
      pollIntervalMs: 50,
      retryDelayMs: 20,
    });

    const recordBefore = readHealthRecord(healthPath, ports);
    expect(recordBefore?.watch_active).toBe(false);

    watcher.start(() => {});

    const recordRunning = readHealthRecord(healthPath, ports);
    expect(recordRunning?.watch_active).toBe(true);

    const inspected = inspectDaemon(roomId, readerId, {}, ports);
    expect(inspected.watch_active).toBe(true);

    for (const listener of errorListeners) {
      listener();
    }

    const recordFailed = readHealthRecord(healthPath, ports);
    expect(recordFailed?.watch_active).toBe(false);
    expect(recordFailed?.watch_failures).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 60));

    const recordRecovered = readHealthRecord(healthPath, ports);
    expect(recordRecovered?.watch_active).toBe(true);

    watcher.stop();

    const recordStopped = readHealthRecord(healthPath, ports);
    expect(recordStopped?.watch_active).toBe(false);

    const inspectedStopped = inspectDaemon(roomId, readerId, {}, ports);
    expect(inspectedStopped.watch_active).toBe(false);
  });

  it("attaches watcher and sets watch_active true when room directory is created after daemon start", async () => {
    const vfs = new ChatVirtualFS();
    const roomId = "delayed-health-room";
    const readerId = "agent-delayed";
    const healthPath = daemonHealthPath(roomId, readerId);

    vfs.mkdirSync(dirname(healthPath), { recursive: true });
    const initialHealth = createInitialHealthRecord(
      roomId,
      readerId,
      44111,
      new Date().toISOString(),
      "boot-delayed",
    );
    vfs.writeFileSync(healthPath, JSON.stringify(initialHealth, null, 2));

    const ports = createVirtualPorts(vfs);
    const watcher = new DaemonWatcher(roomId, {
      reader: readerId,
      healthPath,
      ports,
      pollIntervalMs: 25,
      retryDelayMs: 15,
    });

    watcher.start(() => {});

    const recordBefore = readHealthRecord(healthPath, ports);
    expect(recordBefore?.watch_active).toBe(false);
    expect(inspectDaemon(roomId, readerId, {}, ports).watch_active).toBe(false);

    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));

    await new Promise((resolve) => setTimeout(resolve, 60));

    const recordAfter = readHealthRecord(healthPath, ports);
    expect(recordAfter?.watch_active).toBe(true);
    expect(inspectDaemon(roomId, readerId, {}, ports).watch_active).toBe(true);

    watcher.stop();
  });

  it("records watch_active false when watch fails while message delivery continues via poll loop", async () => {
    const vfs = new ChatVirtualFS();
    const roomId = "fail-poll-room";
    const readerId = "agent-poll";
    const healthPath = daemonHealthPath(roomId, readerId);

    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));
    vfs.mkdirSync(dirname(healthPath), { recursive: true });

    const initialHealth = createInitialHealthRecord(
      roomId,
      readerId,
      55111,
      new Date().toISOString(),
      "boot-poll",
    );
    vfs.writeFileSync(healthPath, JSON.stringify(initialHealth, null, 2));

    let watchShouldFail = false;
    const errorListeners: Array<() => void> = [];
    const basePorts = createVirtualPorts(vfs);
    const ports: DaemonWatcherPorts = {
      ...basePorts,
      watch: (targetPath, opts, listener) => {
        if (watchShouldFail) {
          throw new Error("EACCES: watch disabled");
        }
        const h = basePorts.watch!(targetPath, opts, listener);
        return {
          close: () => h.close(),
          on: (event: "error", errCb: () => void) => {
            if (event === "error") {
              errorListeners.push(errCb);
            }
          },
        };
      },
    };

    const receivedWakes: Array<{ source: WakeSource; tokenChanged: boolean }> = [];
    const watcher = new DaemonWatcher(roomId, {
      reader: readerId,
      healthPath,
      ports,
      pollIntervalMs: 25,
      retryDelayMs: 500,
    });

    watcher.start((source, changed) => {
      receivedWakes.push({ source, tokenChanged: changed });
    });

    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(true);

    watchShouldFail = true;
    for (const listener of errorListeners) {
      listener();
    }

    const failedRecord = readHealthRecord(healthPath, ports);
    expect(failedRecord?.watch_active).toBe(false);
    expect(failedRecord?.watch_failures).toBeGreaterThan(0);

    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 2 }));

    await new Promise((resolve) => setTimeout(resolve, 70));

    const pollWakes = receivedWakes.filter((w) => w.source === "poll" && w.tokenChanged);
    expect(pollWakes.length).toBeGreaterThan(0);
    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(false);

    watcher.stop();
  });
});
