import type { ReactiveEvent, WatchdogEvent, WatchdogEventListener } from "./types.ts";

export class WatchdogEventEmitter {
  private readonly listeners = new Map<string, Set<WatchdogEventListener>>();

  public on(event: string, listener: WatchdogEventListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      this.off(event, listener);
    };
  }

  public off(event: string, listener: WatchdogEventListener): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  public addEventListener(event: string, listener: WatchdogEventListener): () => void {
    return this.on(event, listener);
  }

  public removeEventListener(event: string, listener: WatchdogEventListener): void {
    this.off(event, listener);
  }

  public emit(event: WatchdogEvent): void {
    const specific = this.listeners.get(event.type);
    if (specific) {
      for (const listener of specific) {
        try {
          void listener(event);
        } catch {}
      }
    }
    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const listener of wildcard) {
        try {
          void listener(event);
        } catch {}
      }
    }
  }

  public emitCustom(eventType: string, payload: ReactiveEvent | WatchdogEvent): void {
    const specific = this.listeners.get(eventType);
    if (specific) {
      for (const listener of specific) {
        try {
          void listener(payload);
        } catch {}
      }
    }
  }

  public emitCustomEvent(event: ReactiveEvent): void {
    this.emit({ type: "event_notified", event });
    if (event.type !== "event_notified") {
      this.emitCustom(event.type, event);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
