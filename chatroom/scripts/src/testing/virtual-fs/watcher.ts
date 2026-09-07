import { EventEmitter } from "node:events";
import type { IVirtualFSWatcher, WatchEventType, WatchListener } from "./types.ts";

export class VirtualWatcher extends EventEmitter implements IVirtualFSWatcher {
  readonly path: string;
  readonly recursive: boolean;
  private isClosed = false;
  private readonly cleanupCallback?: ((watcher: VirtualWatcher) => void) | undefined;

  constructor(
    path: string,
    recursive: boolean,
    listener?: WatchListener | undefined,
    cleanupCallback?: ((watcher: VirtualWatcher) => void) | undefined,
  ) {
    super();
    this.path = path;
    this.recursive = recursive;
    this.cleanupCallback = cleanupCallback;
    if (listener) {
      this.on("change", (eventType: WatchEventType, filename: string | null) => {
        listener(eventType, filename);
      });
    }
  }

  emitEvent(eventType: WatchEventType, filename: string | null): void {
    if (this.isClosed) {
      return;
    }
    this.emit("change", eventType, filename);
  }

  close(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.removeAllListeners();
    if (this.cleanupCallback) {
      this.cleanupCallback(this);
    }
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}
