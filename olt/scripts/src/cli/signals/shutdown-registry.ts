import type { ProcessSignal, RegisteredShutdownHook, ShutdownHook } from "./types.ts";

export class ShutdownRegistry {
  private static instance: ShutdownRegistry | null = null;
  private readonly hooks: RegisteredShutdownHook[] = [];
  private isExecuting = false;

  public static getInstance(): ShutdownRegistry {
    if (!ShutdownRegistry.instance) {
      ShutdownRegistry.instance = new ShutdownRegistry();
    }
    return ShutdownRegistry.instance;
  }

  public static resetInstance(): void {
    if (ShutdownRegistry.instance) {
      ShutdownRegistry.instance.clear();
      ShutdownRegistry.instance = null;
    }
  }

  public register(hook: ShutdownHook, priority = 0): () => void {
    const id = `hook_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`;
    const entry: RegisteredShutdownHook = { id, hook, priority };
    this.hooks.push(entry);
    this.hooks.sort((a, b) => b.priority - a.priority);

    return () => {
      const idx = this.hooks.findIndex((h) => h.id === id);
      if (idx !== -1) {
        this.hooks.splice(idx, 1);
      }
    };
  }

  public async runHooks(signal?: ProcessSignal): Promise<void> {
    if (this.isExecuting) return;
    this.isExecuting = true;

    const snapshot = [...this.hooks];
    for (const entry of snapshot) {
      try {
        await entry.hook(signal);
      } catch {
        void 0;
      }
    }

    this.isExecuting = false;
  }

  public clear(): void {
    this.hooks.length = 0;
    this.isExecuting = false;
  }

  public count(): number {
    return this.hooks.length;
  }
}

export function registerShutdownHook(hook: ShutdownHook, priority = 0): () => void {
  return ShutdownRegistry.getInstance().register(hook, priority);
}

export function runShutdownHooks(signal?: ProcessSignal): Promise<void> {
  return ShutdownRegistry.getInstance().runHooks(signal);
}

export function clearShutdownHooks(): void {
  ShutdownRegistry.getInstance().clear();
}

export function getShutdownHookCount(): number {
  return ShutdownRegistry.getInstance().count();
}
