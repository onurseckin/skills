import { describe, expect, it } from "bun:test";
import { roomLogDir, roomLogIndexPath, roomLogSegmentPath } from "../../src/core/index.ts";
import {
  computeChangeToken,
  DaemonWatcher,
  hasTokenChanged,
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
});
