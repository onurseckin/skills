import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CapturePageDriver,
} from "../runners/types.ts";
import { BrowserPoolManager } from "./pool-manager.ts";
import type { BrowserPoolOptions, IPooledBrowserInstance } from "./types.ts";

export class PooledCaptureBrowserDriver implements CaptureBrowserDriver {
  private readonly _instance: IPooledBrowserInstance;
  private readonly _pool: BrowserPoolManager;
  private _isClosed = false;

  constructor(instance: IPooledBrowserInstance, pool: BrowserPoolManager) {
    this._instance = instance;
    this._pool = pool;
  }

  get instanceId(): string {
    return this._instance.id;
  }

  async newPage(): Promise<CapturePageDriver> {
    if (this._isClosed) {
      throw new Error(`PooledCaptureBrowserDriver for ${this._instance.id} is closed`);
    }
    return this._instance.newPage();
  }

  async close(): Promise<void> {
    if (this._isClosed) {
      return;
    }
    this._isClosed = true;
    await this._pool.release(this._instance);
  }
}

export class PooledCaptureBrowserProvider implements CaptureBrowserProvider {
  private readonly _pool: BrowserPoolManager;

  constructor(options: BrowserPoolOptions) {
    this._pool = new BrowserPoolManager(options);
  }

  get pool(): BrowserPoolManager {
    return this._pool;
  }

  async launch(_options?: { headless?: boolean }): Promise<CaptureBrowserDriver> {
    const instance = await this._pool.acquire();
    return new PooledCaptureBrowserDriver(instance, this._pool);
  }

  async close(): Promise<void> {
    await this._pool.close();
  }
}
