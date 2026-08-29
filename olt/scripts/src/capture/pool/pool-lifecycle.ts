import { PooledBrowserInstance } from "./browser-instance.ts";
import type { AcquireQueue } from "./pool-queue.ts";
import type { BrowserPoolOptions } from "./types.ts";

export async function createPoolInstance(
  provider: BrowserPoolOptions["provider"],
  headless: boolean,
): Promise<PooledBrowserInstance> {
  const driver = await provider.launch({ headless });
  return new PooledBrowserInstance(driver);
}

export async function drainIdleInstances(
  instances: Map<string, PooledBrowserInstance>,
  idleInstances: PooledBrowserInstance[],
): Promise<number> {
  const idleToClose = [...idleInstances];
  idleInstances.length = 0;
  let closedCount = 0;
  for (const idle of idleToClose) {
    instances.delete(idle.id);
    closedCount += 1;
    await idle.close();
  }
  return closedCount;
}

export async function closeAllInstances(
  instances: Map<string, PooledBrowserInstance>,
  idleInstances: PooledBrowserInstance[],
  pendingQueue: AcquireQueue,
): Promise<number> {
  pendingQueue.clearAndRejectAll(new Error("Browser pool was closed"));
  const all = Array.from(instances.values());
  instances.clear();
  idleInstances.length = 0;
  let closedCount = 0;
  for (const inst of all) {
    closedCount += 1;
    await inst.close();
  }
  return closedCount;
}
