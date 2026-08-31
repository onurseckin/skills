import { describe, expect, it } from "bun:test";
import {
  BrowserPoolManager,
  PooledBrowserInstance,
} from "../../../olt/scripts/src/capture/pool/index.ts";
import {
  AcquireQueue,
  isInstanceExpired,
} from "../../../olt/scripts/src/capture/pool/pool-queue.ts";
import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CapturePageDriver,
} from "../../../olt/scripts/src/capture/runners/types.ts";

function createMockDriver(): CaptureBrowserDriver {
  return {
    newPage: async (): Promise<CapturePageDriver> => ({
      setViewportSize: async () => {},
      setExtraHTTPHeaders: async () => {},
      goto: async () => {},
      waitForSelector: async () => {},
      screenshot: async () => Buffer.alloc(10),
    }),
    close: async () => {},
  };
}

function createMockProvider(): CaptureBrowserProvider {
  return {
    launch: async () => createMockDriver(),
    close: async () => {},
  };
}

describe("AcquireQueue & isInstanceExpired", () => {
  it("manages pending acquire items in FIFO queue with timer removals", () => {
    const queue = new AcquireQueue();
    expect(queue.length).toBe(0);
    expect(queue.dequeue()).toBeUndefined();

    let resolvedInstance: unknown;
    let rejectedError: unknown;

    const timer1 = setTimeout(() => {}, 10000);
    const timer2 = setTimeout(() => {}, 10000);

    queue.enqueue({
      resolve: (inst) => {
        resolvedInstance = inst;
      },
      reject: (err) => {
        rejectedError = err;
      },
      timer: timer1,
    });

    queue.enqueue({
      resolve: () => {},
      reject: (err) => {
        rejectedError = err;
      },
      timer: timer2,
    });

    expect(queue.length).toBe(2);

    const nonExistentTimer = setTimeout(() => {}, 10000);
    expect(queue.removeByTimer(nonExistentTimer)).toBe(false);
    clearTimeout(nonExistentTimer);

    expect(queue.removeByTimer(timer1)).toBe(true);
    expect(queue.length).toBe(1);
    clearTimeout(timer1);

    queue.clearAndRejectAll(new Error("Queue aborted"));
    expect(queue.length).toBe(0);
    expect((rejectedError as Error).message).toBe("Queue aborted");
  });

  it("isInstanceExpired checks status, usage limit, and idle timeout", async () => {
    const driver = createMockDriver();
    const inst = new PooledBrowserInstance(driver, "inst-exp");

    expect(isInstanceExpired(inst, { maxUsesPerInstance: 10, idleTimeoutMs: 10000 })).toBe(false);

    inst.markUnhealthy();
    expect(isInstanceExpired(inst, { maxUsesPerInstance: 10, idleTimeoutMs: 10000 })).toBe(true);

    const instDisp = new PooledBrowserInstance(driver, "inst-disp-exp");
    await instDisp.close();
    expect(isInstanceExpired(instDisp, { maxUsesPerInstance: 10, idleTimeoutMs: 10000 })).toBe(
      true,
    );

    const inst2 = new PooledBrowserInstance(driver, "inst-uses");
    inst2.markBusy();
    inst2.markIdle();
    expect(isInstanceExpired(inst2, { maxUsesPerInstance: 1, idleTimeoutMs: 10000 })).toBe(true);

    const inst3 = new PooledBrowserInstance(driver, "inst-idle");
    expect(isInstanceExpired(inst3, { maxUsesPerInstance: 10, idleTimeoutMs: -1 })).toBe(false);
    expect(isInstanceExpired(inst3, { maxUsesPerInstance: 10, idleTimeoutMs: 0 })).toBe(false);

    await new Promise((res) => setTimeout(res, 20));
    expect(isInstanceExpired(inst3, { maxUsesPerInstance: 10, idleTimeoutMs: 10 })).toBe(true);
  });
});

describe("BrowserPoolManager Lease Operations", () => {
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

  it("executes operations with withBrowser helper and cleans up on error", async () => {
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

    await expect(
      pool.withBrowser(async () => {
        throw new Error("Simulated failure in withBrowser");
      }),
    ).rejects.toThrow("Simulated failure in withBrowser");

    expect(pool.getStats().busyInstances).toBe(0);
    expect(pool.getStats().idleInstances).toBe(1);

    await pool.close();
  });
});
