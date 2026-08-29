import { randomUUID } from "node:crypto";
import type { CaptureBrowserDriver, CapturePageDriver } from "../runners/types.ts";
import type { BrowserInstanceStatus, IPooledBrowserInstance } from "./types.ts";

export class PooledBrowserInstance implements IPooledBrowserInstance {
  readonly id: string;
  readonly createdAt: number;
  private _status: BrowserInstanceStatus;
  private _lastActiveAt: number;
  private _useCount: number;
  private readonly _driver: CaptureBrowserDriver;

  constructor(driver: CaptureBrowserDriver, id?: string) {
    this.id = id ?? randomUUID();
    this.createdAt = Date.now();
    this._lastActiveAt = this.createdAt;
    this._status = "IDLE";
    this._useCount = 0;
    this._driver = driver;
  }

  get status(): BrowserInstanceStatus {
    return this._status;
  }

  get lastActiveAt(): number {
    return this._lastActiveAt;
  }

  get useCount(): number {
    return this._useCount;
  }

  get driver(): CaptureBrowserDriver {
    return this._driver;
  }

  markBusy(): void {
    if (this._status === "DISPOSED") {
      throw new Error(`Cannot mark disposed instance ${this.id} as busy`);
    }
    this._status = "BUSY";
    this._useCount += 1;
    this._lastActiveAt = Date.now();
  }

  markIdle(): void {
    if (this._status === "DISPOSED") {
      return;
    }
    this._status = "IDLE";
    this._lastActiveAt = Date.now();
  }

  markUnhealthy(): void {
    if (this._status !== "DISPOSED") {
      this._status = "UNHEALTHY";
    }
  }

  async newPage(): Promise<CapturePageDriver> {
    if (this._status === "DISPOSED") {
      throw new Error(`Cannot open new page on disposed browser instance ${this.id}`);
    }
    this._lastActiveAt = Date.now();
    return this._driver.newPage();
  }

  async isHealthy(): Promise<boolean> {
    if (this._status === "DISPOSED" || this._status === "UNHEALTHY") {
      return false;
    }
    try {
      const page = await this._driver.newPage();
      if (page.evaluate) {
        await page.evaluate(() => true);
      }
      return true;
    } catch {
      this._status = "UNHEALTHY";
      return false;
    }
  }

  async close(): Promise<void> {
    if (this._status === "DISPOSED") {
      return;
    }
    this._status = "DISPOSED";
    try {
      await this._driver.close();
    } catch {
    }
  }
}
