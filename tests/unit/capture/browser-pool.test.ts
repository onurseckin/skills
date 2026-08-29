import { describe, expect, it } from "bun:test";
import {
  BrowserPoolManager,
  PooledBrowserInstance,
  PooledCaptureBrowserDriver,
  PooledCaptureBrowserProvider,
  type BrowserPoolEvent,
} from "../../../olt/scripts/src/capture/pool/index.ts";
import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CapturePageDriver,
} from "../../../olt/scripts/src/capture/runners/types.ts";

function createMockDriver(options?: {
  readonly onNewPage?: () => void;
  readonly onClose?: () => void;
}): CaptureBrowserDriver {
  return {
    newPage: async (): Promise<CapturePageDriver> => {
      if (options?.onNewPage) {
        options.onNewPage();
      }
      return {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(10),
        evaluate: async <T>() => true as unknown as T,
      };
    },
    close: async () => {
      if (options?.onClose) {
        options.onClose();
      }
    },
  };
}

function createMockProvider(options?: {
  readonly onLaunch?: () => void;
  readonly onClose?: () => void;
}): CaptureBrowserProvider {
  return {
    launch: async () => {
      if (options?.onLaunch) {
        options.onLaunch();
      }
      return createMockDriver({ onClose: options?.onClose });
    },
  };
}

describe("BrowserPoolManager & Lifecycle", () => {
  it("initializes with default options and prewarms min instances", async () => {
    let launchCount = 0;
    const provider = createMockProvider({
      onLaunch: () => {
        launchCount += 1;
      },
    });

    const events: BrowserPoolEvent[] = [];
    const pool = new BrowserPoolManager({
      provider,
      minInstances: 2,
      maxInstances: 4,
      onEvent: (e) => events.push(e),
    });

    expect(pool.state).toBe("READY");
    expect(pool.getStats().totalInstances).toBe(0);

    await pool.prewarm();

    expect(launchCount).toBe(2);
    expect(pool.getStats().totalInstances).toBe(2);
    expect(pool.getStats().idleInstances).toBe(2);
    expect(pool.getStats().busyInstances).toBe(0);
    expect(events.filter((e) => e.type === "instance_created")).toHaveLength(2);

    await pool.close();
    expect(pool.state).toBe("CLOSED");
  });

  it("acquires and releases instances correctly", async () => {
    const provider = createMockProvider();
    const pool = new BrowserPoolManager({
      provider,
      minInstances: 1,
      maxInstances: 3,
    });

    await pool.prewarm();
    const inst = await pool.acquire();

    expect(inst.status).toBe("BUSY");
    expect(inst.useCount).toBe(1);
    expect(pool.getStats().busyInstances).toBe(1);
    expect(pool.getStats().idleInstances).toBe(0);

    const page = await inst.newPage();
    expect(page).toBeDefined();

    await pool.release(inst);
    expect(inst.status).toBe("IDLE");
    expect(pool.getStats().busyInstances).toBe(0);
    expect(pool.getStats().idleInstances).toBe(1);

    await pool.close();
  });

  it("executes operations with withBrowser helper", async () => {
    const provider = createMockProvider();
    const pool = new BrowserPoolManager({
      provider,
      maxInstances: 2,
    });

    const result = await pool.withBrowser(async (inst) => {
      expect(inst.status).toBe("BUSY");
      return "captured-data";
    });

    expect(result).toBe("captured-data");
    expect(pool.getStats().idleInstances).toBe(1);
    expect(pool.getStats().busyInstances).toBe(0);

    await pool.close();
  });

  it("respects maxInstances and queues concurrent acquire requests", async () => {
    const provider = createMockProvider();
    const pool = new BrowserPoolManager({
      provider,
      maxInstances: 1,
      acquireTimeoutMs: 1000,
    });

    const inst1 = await pool.acquire();
    expect(pool.getStats().busyInstances).toBe(1);

    let acquiredSecond = false;
    const secondPromise = pool.acquire().then((inst2) => {
      acquiredSecond = true;
      return inst2;
    });

    expect(pool.getStats().pendingAcquires).toBe(1);
    expect(acquiredSecond).toBe(false);

    await pool.release(inst1);
    const inst2 = await secondPromise;

    expect(acquiredSecond).toBe(true);
    expect(inst2.id).toBe(inst1.id);
    expect(inst2.useCount).toBe(2);

    await pool.release(inst2);
    await pool.close();
  });

  it("times out pending acquire if pool remains exhausted", async () => {
    const provider = createMockProvider();
    const pool = new BrowserPoolManager({
      provider,
      maxInstances: 1,
      acquireTimeoutMs: 50,
    });

    const inst1 = await pool.acquire();

    await expect(pool.acquire()).rejects.toThrow(/timed out/);

    await pool.release(inst1);
    await pool.close();
  });

  it("evicts instances exceeding maxUsesPerInstance upon release", async () => {
    let closeCount = 0;
    const provider = createMockProvider({
      onClose: () => {
        closeCount += 1;
      },
    });

    const pool = new BrowserPoolManager({
      provider,
      maxInstances: 2,
      maxUsesPerInstance: 2,
    });

    const inst = await pool.acquire();
    await pool.release(inst);
    expect(closeCount).toBe(0);

    const instAgain = await pool.acquire();
    expect(instAgain.id).toBe(inst.id);
    expect(instAgain.useCount).toBe(2);

    await pool.release(instAgain);
    expect(closeCount).toBe(1);
    expect(pool.getStats().totalEvicted).toBe(1);
    expect(pool.getStats().idleInstances).toBe(0);

    await pool.close();
  });

  it("handles drain and graceful shutdown", async () => {
    let closeCount = 0;
    const provider = createMockProvider({
      onClose: () => {
        closeCount += 1;
      },
    });

    const pool = new BrowserPoolManager({
      provider,
      minInstances: 2,
      maxInstances: 2,
    });

    await pool.prewarm();
    expect(pool.getStats().idleInstances).toBe(2);

    await pool.drain();
    expect(pool.state).toBe("CLOSED");
    expect(closeCount).toBe(2);
    expect(pool.getStats().totalInstances).toBe(0);
  });

  it("integrates PooledCaptureBrowserProvider and Driver adapter", async () => {
    const provider = createMockProvider();
    const pooledProvider = new PooledCaptureBrowserProvider({
      provider,
      maxInstances: 2,
    });

    const driver = await pooledProvider.launch();
    expect(driver).toBeDefined();

    const page = await driver.newPage();
    expect(page).toBeDefined();

    await driver.close();
    expect(pooledProvider.pool.getStats().idleInstances).toBe(1);

    await pooledProvider.close();
    expect(pooledProvider.pool.state).toBe("CLOSED");
  });
});
