import { describe, expect, it } from "bun:test";
import {
  BrowserPoolManager,
  type BrowserPoolEvent,
} from "../../../olt/scripts/src/capture/pool/index.ts";
import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CapturePageDriver,
} from "../../../olt/scripts/src/capture/runners/types.ts";

function createMockDriver(options?: {
  readonly onClose?: () => void;
  readonly throwOnClose?: boolean;
}): CaptureBrowserDriver {
  return {
    newPage: async (): Promise<CapturePageDriver> => ({
      setViewportSize: async () => {},
      setExtraHTTPHeaders: async () => {},
      goto: async () => {},
      waitForSelector: async () => {},
      screenshot: async () => Buffer.alloc(10),
      evaluate: async <T>() => true as unknown as T,
    }),
    close: async () => {
      if (options?.onClose) {
        options.onClose();
      }
      if (options?.throwOnClose) {
        throw new Error("Failed to close driver");
      }
    },
  };
}

function createMockProvider(options?: {
  readonly onLaunch?: () => void;
  readonly onClose?: () => void;
  readonly throwOnLaunch?: boolean;
}): CaptureBrowserProvider {
  return {
    launch: async () => {
      if (options?.throwOnLaunch) {
        throw new Error("Launch failed");
      }
      if (options?.onLaunch) {
        options.onLaunch();
      }
      return createMockDriver({ onClose: options?.onClose });
    },
    close: async () => {
      if (options?.onClose) {
        options.onClose();
      }
    },
  };
}

describe("BrowserPoolManager Concurrency & Eviction", () => {
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

  it("handles pool error events on provider launch failure", async () => {
    const events: BrowserPoolEvent[] = [];
    const failingProvider = createMockProvider({ throwOnLaunch: true });
    const pool = new BrowserPoolManager({
      provider: failingProvider,
      maxInstances: 2,
      onEvent: (e) => events.push(e),
    });

    await expect(pool.acquire()).rejects.toThrow("Launch failed");
    expect(events.some((e) => e.type === "error" && e.details?.includes("Launch failed"))).toBe(
      true,
    );

    await pool.close();
  });

  it("handles drain and graceful shutdown, ignoring repeated calls", async () => {
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
      healthCheckIntervalMs: 100,
      idleTimeoutMs: 50,
    });

    await pool.prewarm();
    expect(pool.getStats().idleInstances).toBe(2);

    await pool.drain();
    expect(pool.state).toBe("CLOSED");
    expect(closeCount).toBe(2);
    expect(pool.getStats().totalInstances).toBe(0);

    await pool.close();
    await pool.drain();
    expect(pool.state).toBe("CLOSED");

    await expect(pool.acquire()).rejects.toThrow(
      "Cannot acquire browser instance from pool in CLOSED state",
    );
  });

  it("performs background housekeeping on expired idle instances", async () => {
    let closeCount = 0;
    const provider = createMockProvider({
      onClose: () => {
        closeCount++;
      },
    });

    const pool = new BrowserPoolManager({
      provider,
      minInstances: 0,
      maxInstances: 2,
      idleTimeoutMs: 10,
      healthCheckIntervalMs: 15,
    });

    const inst = await pool.acquire();
    await pool.release(inst);
    expect(pool.getStats().idleInstances).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(pool.getStats().idleInstances).toBe(0);
    expect(closeCount).toBe(1);

    await pool.close();
  });
});
