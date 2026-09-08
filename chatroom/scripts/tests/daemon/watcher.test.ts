import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
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
  type WakeSource,
} from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

function createVirtualPorts(vfs: ChatVirtualFS): DaemonWatcherPorts {
  return {
    existsSync: (targetPath: string) => vfs.existsSync(targetPath),
    watch: (targetPath: string, _opts, listener) => {
      const vw = vfs.watch(targetPath, (_event, filename) => listener("change", filename));
      return { close: () => vw.close(), on: () => {} };
    },
    readdirSync: (dirPath: string) => vfs.readdirSync(dirPath) as string[],
    readFileSync: (filePath: string) => vfs.readFileSync(filePath, "utf8"),
    statSync: (targetPath: string) => ({ size: vfs.statSync(targetPath)?.size ?? 0, ino: 1 }),
    writeAtomic: (targetPath: string, content: string) => {
      vfs.mkdirSync(dirname(targetPath), { recursive: true });
      vfs.writeFileSync(targetPath, content);
    },
    writeFileSync: (targetPath: string, content: string) => vfs.writeFileSync(targetPath, content),
  };
}

describe("DaemonWatcher attachment retry and unconditional polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes with watch_active false when room directory does not exist", () => {
    const watcher = new DaemonWatcher("uncreated-room", {
      ports: createVirtualPorts(new ChatVirtualFS()),
    });
    const metrics = watcher.getMetrics();
    expect(metrics.watch_active).toBe(false);
    expect(metrics.watch_failures).toBe(0);
    expect(metrics.poll_interval_ms).toBe(750);
    expect(metrics.wakes_by_source).toEqual({ watch: 0, poll: 0, tick: 0, token: 0 });
  });

  it("retries attachment and activates watcher when room directory is created after startup", () => {
    const vfs = new ChatVirtualFS();
    const roomId = "delayed-room";
    const watcher = new DaemonWatcher(roomId, {
      ports: createVirtualPorts(vfs),
      pollIntervalMs: 25,
      retryDelayMs: 10,
    });
    const receivedWakes: WakeSource[] = [];
    watcher.start((source) => receivedWakes.push(source));
    expect(watcher.getMetrics().watch_active).toBe(false);

    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));
    vi.advanceTimersByTime(25);

    expect(watcher.getMetrics().watch_active).toBe(true);
    expect(watcher.getMetrics().watch_failures).toBe(0);

    watcher.stop();
    expect(watcher.getMetrics().watch_active).toBe(false);
    expect(receivedWakes.length).toBeGreaterThan(0);
  });

  it("maintains unconditional 750ms poll loop active at all times", () => {
    const vfs = new ChatVirtualFS();
    const roomId = "poll-room";
    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));
    const watcher = new DaemonWatcher(roomId, {
      ports: createVirtualPorts(vfs),
      pollIntervalMs: 20,
    });
    const wakes: WakeSource[] = [];
    watcher.start((source) => wakes.push(source));

    vi.advanceTimersByTime(70);
    watcher.stop();

    expect(watcher.getMetrics().poll_interval_ms).toBe(20);
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
          on: (event, errCb) => {
            if (event === "error" && targetPath.includes("/log")) errorListeners.push(errCb);
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
    expect(watcher.getMetrics().watch_active).toBe(true);
    expect(watcher.getMetrics().watch_failures).toBe(0);
    expect(watcher.getMetrics().poll_interval_ms).toBe(750);

    for (const listener of errorListeners) listener();

    expect(watcher.getMetrics().watch_failures).toBeGreaterThan(0);
    expect(watcher.getMetrics().poll_interval_ms).toBe(750);

    vi.advanceTimersByTime(60);

    expect(watcher.getMetrics().watch_active).toBe(true);
    expect(watcher.getMetrics().poll_interval_ms).toBe(750);
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
    vfs.mkdirSync(dirname(healthPath), { recursive: true });
    vfs.writeFileSync(
      healthPath,
      JSON.stringify(
        createInitialHealthRecord(roomId, readerId, 12345, new Date().toISOString(), "test-boot"),
      ),
    );

    const errorListeners: Array<() => void> = [];
    const basePorts = createVirtualPorts(vfs);
    const ports: DaemonWatcherPorts = {
      ...basePorts,
      watch: (targetPath, opts, listener) => {
        const h = basePorts.watch!(targetPath, opts, listener);
        return {
          close: () => h.close(),
          on: (event, errCb) => {
            if (event === "error" && targetPath.includes("/log")) errorListeners.push(errCb);
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

    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(false);
    watcher.start(() => {});

    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(true);
    expect(inspectDaemon(roomId, readerId, {}, ports).watch_active).toBe(true);

    for (const listener of errorListeners) listener();

    const recordFailed = readHealthRecord(healthPath, ports);
    expect(recordFailed?.watch_active).toBe(false);
    expect(recordFailed?.watch_failures).toBeGreaterThan(0);

    vi.advanceTimersByTime(60);
    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(true);
    watcher.stop();

    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(false);
    expect(inspectDaemon(roomId, readerId, {}, ports).watch_active).toBe(false);
  });

  it("attaches watcher and sets watch_active true when room directory is created after daemon start", async () => {
    const vfs = new ChatVirtualFS();
    const roomId = "delayed-health-room";
    const readerId = "agent-delayed";
    const healthPath = daemonHealthPath(roomId, readerId);
    vfs.mkdirSync(dirname(healthPath), { recursive: true });
    vfs.writeFileSync(
      healthPath,
      JSON.stringify(
        createInitialHealthRecord(
          roomId,
          readerId,
          44111,
          new Date().toISOString(),
          "boot-delayed",
        ),
      ),
    );

    const ports = createVirtualPorts(vfs);
    const watcher = new DaemonWatcher(roomId, {
      reader: readerId,
      healthPath,
      ports,
      pollIntervalMs: 25,
      retryDelayMs: 15,
    });
    watcher.start(() => {});
    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(false);
    expect(inspectDaemon(roomId, readerId, {}, ports).watch_active).toBe(false);

    vfs.mkdirSync(roomLogDir(roomId), { recursive: true });
    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 1 }));
    vi.advanceTimersByTime(60);

    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(true);
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
    vfs.writeFileSync(
      healthPath,
      JSON.stringify(
        createInitialHealthRecord(roomId, readerId, 55111, new Date().toISOString(), "boot-poll"),
      ),
    );

    let watchShouldFail = false;
    const errorListeners: Array<() => void> = [];
    const basePorts = createVirtualPorts(vfs);
    const ports: DaemonWatcherPorts = {
      ...basePorts,
      watch: (targetPath, opts, listener) => {
        if (watchShouldFail) throw new Error("EACCES: watch disabled");
        const h = basePorts.watch!(targetPath, opts, listener);
        return {
          close: () => h.close(),
          on: (event, errCb) => {
            if (event === "error") errorListeners.push(errCb);
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

    watcher.start((source, changed) => receivedWakes.push({ source, tokenChanged: changed }));

    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(true);

    watchShouldFail = true;
    for (const listener of errorListeners) listener();

    const failedRecord = readHealthRecord(healthPath, ports);
    expect(failedRecord?.watch_active).toBe(false);
    expect(failedRecord?.watch_failures).toBeGreaterThan(0);

    vfs.writeFileSync(roomLogIndexPath(roomId), JSON.stringify({ next_seq: 2 }));

    vi.advanceTimersByTime(70);

    const pollWakes = receivedWakes.filter((w) => w.source === "poll" && w.tokenChanged);
    expect(pollWakes.length).toBeGreaterThan(0);
    expect(readHealthRecord(healthPath, ports)?.watch_active).toBe(false);

    watcher.stop();
  });

  it("tracks and increments wakes_by_source when watch, poll, tick, and token wakes fire", async () => {
    const watcher = new DaemonWatcher("wakes-count-room", {
      ports: createVirtualPorts(new ChatVirtualFS()),
    });
    expect(watcher.getMetrics().wakes_by_source).toEqual({ watch: 0, poll: 0, tick: 0, token: 0 });

    for (const source of ["watch", "poll", "poll", "tick", "tick", "tick", "token"] as const) {
      await watcher.triggerWake(source);
    }

    expect(watcher.getMetrics().wakes_by_source).toEqual({ watch: 1, poll: 2, tick: 3, token: 1 });
  });

  it("persists and derives wakes_by_source in health record across wakes and stop", async () => {
    const vfs = new ChatVirtualFS();
    const roomId = "health-wakes-source-room";
    const readerId = "agent-wakes-source";
    const healthPath = daemonHealthPath(roomId, readerId);
    vfs.mkdirSync(dirname(healthPath), { recursive: true });
    vfs.writeFileSync(
      healthPath,
      JSON.stringify(
        createInitialHealthRecord(roomId, readerId, 9876, new Date().toISOString(), "boot-wakes"),
      ),
    );

    const ports = createVirtualPorts(vfs);
    const watcher = new DaemonWatcher(roomId, {
      reader: readerId,
      healthPath,
      ports,
      pollIntervalMs: 50,
      retryDelayMs: 20,
    });
    watcher.start(() => {});

    expect(readHealthRecord(healthPath, ports)?.wakes_by_source).toEqual({
      watch: 0,
      poll: 0,
      tick: 0,
      token: 0,
    });

    for (const source of ["watch", "token", "tick"] as const) {
      await watcher.triggerWake(source);
    }
    watcher.stop();

    expect(readHealthRecord(healthPath, ports)?.wakes_by_source).toEqual({
      watch: 1,
      poll: 0,
      tick: 1,
      token: 1,
    });
  });
});
