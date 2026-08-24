import { AsyncLock } from "./locks.ts";

export class LeaseManager {
  private lock = new AsyncLock();
  private lastHeartbeat: number = 0;
  private readonly timeout: number = 10000;

  async acquireLease(): Promise<boolean> {
    await this.lock.acquire();
    try {
      const now = performance.now();
      if (this.lastHeartbeat !== 0 && now - this.lastHeartbeat < this.timeout) {
        return false;
      }
      this.lastHeartbeat = now;
      return true;
    } finally {
      this.lock.release();
    }
  }

  async heartbeat(): Promise<void> {
    await this.lock.acquire();
    try {
      const now = performance.now();
      this.lastHeartbeat = now > this.lastHeartbeat ? now : this.lastHeartbeat + 0.001;
    } finally {
      this.lock.release();
    }
  }

  async releaseLease(): Promise<void> {
    await this.lock.acquire();
    try {
      this.lastHeartbeat = 0;
    } finally {
      this.lock.release();
    }
  }
}
