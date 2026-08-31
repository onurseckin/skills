import { describe, expect, it } from "bun:test";
import {
  BrowserPoolManager,
  PooledBrowserInstance,
  PooledCaptureBrowserDriver,
  PooledCaptureBrowserProvider,
  type BrowserPoolEvent,
} from "../../olt/scripts/src/capture/pool/index.ts";
import {
  AcquireQueue,
  isInstanceExpired,
} from "../../olt/scripts/src/capture/pool/pool-queue.ts";
import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CapturePageDriver,
} from "../../olt/scripts/src/capture/runners/types.ts";

function createMockDriver(options?: {
  readonly onNewPage?: () => void;
  readonly onClose?: () => void;
  readonly throwOnNewPage?: boolean;
  readonly throwOnClose?: boolean;
  readonly evaluateThrows?: boolean;
  readonly noEvaluate?: boolean;
}): CaptureBrowserDriver {
  return {
    newPage: async (): Promise<CapturePageDriver> => {
      if (options?.throwOnNewPage) {
        throw new Error("Failed to create new page");
      }
      if (options?.onNewPage) {
        options.onNewPage();
      }
      const pageDriver: CapturePageDriver = {
        setViewportSize: async () => {},
        setExtraHTTPHeaders: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        screenshot: async () => Buffer.alloc(10),
      };
      if (!options?.noEvaluate) {
        pageDriver.evaluate = async <T>() => {
          if (options?.evaluateThrows) {
            throw new Error("Page evaluation failed");
          }
          return true as unknown as T;
        };
      }
      return pageDriver;
    },
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

describe("PooledBrowserInstance", () => {
  it("initializes with default generated UUID or explicit ID", () => {
    const driver = createMockDriver();
    const instDefault = new PooledBrowserInstance(driver);
    expect(instDefault.id).toBeDefined();
    expect(typeof instDefault.id).toBe("string");
    expect(instDefault.id.length).toBeGreaterThan(0);
    expect(instDefault.status).toBe("IDLE");
    expect(instDefault.useCount).toBe(0);
    expect(instDefault.driver).toBe(driver);
    expect(instDefault.createdAt).toBeLessThanOrEqual(Date.now());
    expect(instDefault.lastActiveAt).toBe(instDefault.createdAt);

    const instExplicit = new PooledBrowserInstance(driver, "custom-id-123");
    expect(instExplicit.id).toBe("custom-id-123");
  });

  it("updates state and usage metrics when marked busy and idle", async () => {
    const driver = createMockDriver();
    const inst = new PooledBrowserInstance(driver, "inst-1");

    // Open new page on active instance
    const page = await inst.newPage();
    expect(page).toBeDefined();

    inst.markBusy();
    expect(inst.status).toBe("BUSY");
    expect(inst.useCount).toBe(1);

    inst.markIdle();
    expect(inst.status).toBe("IDLE");
    expect(inst.useCount).toBe(1);

    inst.markUnhealthy();
    expect(inst.status).toBe("UNHEALTHY");
  });

  it("throws when marking disposed instance as busy, and ignores markIdle/markUnhealthy after dispose", async () => {
    const driver = createMockDriver();
    const inst = new PooledBrowserInstance(driver, "inst-disposed");

    await inst.close();
    expect(inst.status).toBe("DISPOSED");

    expect(() => inst.markBusy()).toThrow("Cannot mark disposed instance inst-disposed as busy");

    inst.markIdle();
    expect(inst.status).toBe("DISPOSED");

    inst.markUnhealthy();
    expect(inst.status).toBe("DISPOSED");

    await expect(inst.newPage()).rejects.toThrow(
      "Cannot open new page on disposed browser instance inst-disposed",
    );
  });

  it("evaluates health status correctly for healthy, unhealthy, busy, and disposed instances", async () => {
    const driver = createMockDriver();
    const inst = new PooledBrowserInstance(driver, "inst-health");

    // IDLE state and healthy
    expect(await inst.isHealthy()).toBe(true);

    // BUSY state and healthy
    inst.markBusy();
    expect(await inst.isHealthy()).toBe(true);
    inst.markIdle();

    // Driver without evaluate method on page
    const driverNoEval = createMockDriver({ noEvaluate: true });
    const instNoEval = new PooledBrowserInstance(driverNoEval, "inst-no-eval");
    expect(await instNoEval.isHealthy()).toBe(true);

    // Explicit UNHEALTHY state tested directly
    const instExplicitUnhealthy = new PooledBrowserInstance(driver, "inst-unhealthy");
    instExplicitUnhealthy.markUnhealthy();
    expect(await instExplicitUnhealthy.isHealthy()).toBe(false);

    // Driver that throws on newPage (transitions to UNHEALTHY via catch)
    const failingDriver = createMockDriver({ throwOnNewPage: true });
    const instFailing = new PooledBrowserInstance(failingDriver, "inst-failing");
    expect(await instFailing.isHealthy()).toBe(false);
    expect(instFailing.status).toBe("UNHEALTHY");
    expect(await instFailing.isHealthy()).toBe(false);

    // Page that throws on evaluate
    const evalFailDriver = createMockDriver({ evaluateThrows: true });
    const instEvalFail = new PooledBrowserInstance(evalFailDriver, "inst-eval-fail");
    expect(await instEvalFail.isHealthy()).toBe(false);
    expect(instEvalFail.status).toBe("UNHEALTHY");

    // Disposed instance
    const instDisposed = new PooledBrowserInstance(driver, "inst-disp");
    await instDisposed.close();
    expect(await instDisposed.isHealthy()).toBe(false);
  });

  it("handles driver close errors gracefully and prevents double-close execution", async () => {
    let closeCalls = 0;
    const driverWithErr = createMockDriver({
      onClose: () => {
        closeCalls++;
      },
      throwOnClose: true,
    });
    const inst = new PooledBrowserInstance(driverWithErr, "inst-err");

    await inst.close();
    expect(inst.status).toBe("DISPOSED");
    expect(closeCalls).toBe(1);

    // Second close is no-op
    await inst.close();
    expect(closeCalls).toBe(1);
  });
});

describe("PooledCaptureBrowserDriver & PooledCaptureBrowserProvider", () => {
  it("exposes instanceId and prevents operations after driver is closed", async () => {
    const provider = createMockProvider();
    const pool = new BrowserPoolManager({ provider, maxInstances: 2 });
    const instance = await pool.acquire();

    const driver = new PooledCaptureBrowserDriver(instance, pool);
    expect(driver.instanceId).toBe(instance.id);

    const page = await driver.newPage();
    expect(page).toBeDefined();

    await driver.close();
    // Subsequent close is no-op
    await driver.close();

    await expect(driver.newPage()).rejects.toThrow(
      `PooledCaptureBrowserDriver for ${instance.id} is closed`,
    );

    await pool.close();
  });

  it("PooledCaptureBrowserProvider initializes pool and provides browser drivers", async () => {
    const provider = createMockProvider();
    const pooledProvider = new PooledCaptureBrowserProvider({
      provider,
      maxInstances: 2,
    });

    expect(pooledProvider.pool).toBeDefined();
    expect(pooledProvider.pool.state).toBe("READY");

    const driver = await pooledProvider.launch({ headless: true });
    expect(driver).toBeDefined();

    const page = await driver.newPage();
    expect(page).toBeDefined();

    await driver.close();
    expect(pooledProvider.pool.getStats().idleInstances).toBe(1);

    await pooledProvider.close();
    expect(pooledProvider.pool.state).toBe("CLOSED");
  });
});

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

    // Remove non-existent timer
    const nonExistentTimer = setTimeout(() => {}, 10000);
    expect(queue.removeByTimer(nonExistentTimer)).toBe(false);
    clearTimeout(nonExistentTimer);

    // Remove timer1
    expect(queue.removeByTimer(timer1)).toBe(true);
    expect(queue.length).toBe(1);
    clearTimeout(timer1);

    // Clear and reject all remaining
    queue.clearAndRejectAll(new Error("Queue aborted"));
    expect(queue.length).toBe(0);
    expect((rejectedError as Error).message).toBe("Queue aborted");
  });

  it("isInstanceExpired checks status, usage limit, and idle timeout", async () => {
    const driver = createMockDriver();
    const inst = new PooledBrowserInstance(driver, "inst-exp");

    expect(isInstanceExpired(inst, { maxUsesPerInstance: 10, idleTimeoutMs: 10000 })).toBe(false);

    // Unhealthy status
    inst.markUnhealthy();
    expect(isInstanceExpired(inst, { maxUsesPerInstance: 10, idleTimeoutMs: 10000 })).toBe(true);

    // Disposed status
    const instDisp = new PooledBrowserInstance(driver, "inst-disp-exp");
    await instDisp.close();
    expect(isInstanceExpired(instDisp, { maxUsesPerInstance: 10, idleTimeoutMs: 10000 })).toBe(
      true,
    );

    // Exceeded max uses
    const inst2 = new PooledBrowserInstance(driver, "inst-uses");
    inst2.markBusy();
    inst2.markIdle();
    expect(isInstanceExpired(inst2, { maxUsesPerInstance: 1, idleTimeoutMs: 10000 })).toBe(true);

    // Idle timeout: negative/zero vs expired
    const inst3 = new PooledBrowserInstance(driver, "inst-idle");
    expect(isInstanceExpired(inst3, { maxUsesPerInstance: 10, idleTimeoutMs: -1 })).toBe(false);
    expect(isInstanceExpired(inst3, { maxUsesPerInstance: 10, idleTimeoutMs: 0 })).toBe(false);

    await new Promise((res) => setTimeout(res, 20));
    expect(isInstanceExpired(inst3, { maxUsesPerInstance: 10, idleTimeoutMs: 10 })).toBe(true);
  });
});

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

    // Repeated close/drain when already closed
    await pool.close();
    await pool.drain();
    expect(pool.state).toBe("CLOSED");

    // Acquire on closed pool throws
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

    // Wait for idleTimeout and housekeeping timer to execute
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(pool.getStats().idleInstances).toBe(0);
    expect(closeCount).toBe(1);

    await pool.close();
  });
});
