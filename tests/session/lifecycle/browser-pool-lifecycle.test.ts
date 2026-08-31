import { describe, expect, it } from "bun:test";
import {
  BrowserPoolManager,
  PooledBrowserInstance,
  PooledCaptureBrowserDriver,
  PooledCaptureBrowserProvider,
} from "../../../olt/scripts/src/capture/pool/index.ts";
import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CapturePageDriver,
} from "../../../olt/scripts/src/capture/runners/types.ts";

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

    expect(await inst.isHealthy()).toBe(true);

    inst.markBusy();
    expect(await inst.isHealthy()).toBe(true);
    inst.markIdle();

    const driverNoEval = createMockDriver({ noEvaluate: true });
    const instNoEval = new PooledBrowserInstance(driverNoEval, "inst-no-eval");
    expect(await instNoEval.isHealthy()).toBe(true);

    const instExplicitUnhealthy = new PooledBrowserInstance(driver, "inst-unhealthy");
    instExplicitUnhealthy.markUnhealthy();
    expect(await instExplicitUnhealthy.isHealthy()).toBe(false);

    const failingDriver = createMockDriver({ throwOnNewPage: true });
    const instFailing = new PooledBrowserInstance(failingDriver, "inst-failing");
    expect(await instFailing.isHealthy()).toBe(false);
    expect(instFailing.status).toBe("UNHEALTHY");
    expect(await instFailing.isHealthy()).toBe(false);

    const evalFailDriver = createMockDriver({ evaluateThrows: true });
    const instEvalFail = new PooledBrowserInstance(evalFailDriver, "inst-eval-fail");
    expect(await instEvalFail.isHealthy()).toBe(false);
    expect(instEvalFail.status).toBe("UNHEALTHY");

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
