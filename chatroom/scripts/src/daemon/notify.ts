import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { roomKeyPath, roomManifestPath, type Envelope } from "../core/index.ts";
import { CHATROOM_PUBLIC_KEY } from "../crypto/index.ts";
import {
  readHealthRecord,
  stampStoppedIfOwned,
  writeHealthRecord,
  type DaemonHealthRecord,
  type HealthPorts,
} from "./health.ts";
import { releaseDaemonLock } from "./lock.ts";
import { type DaemonWatcher } from "./watcher.ts";

export interface NotifyResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

export interface NotifyProcessStream {
  write(chunk: string): boolean;
  end(): void;
  on?(event: "error", listener: (err: Error) => void): this;
}

export interface NotifyProcessChild {
  readonly stdin: NotifyProcessStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit", listener: (code: number | null, signal: string | null) => void): this;
  once(event: "error", listener: (err: Error) => void): this;
}

export type NotifySpawner = (
  command: string,
  options: { readonly shell: true; readonly stdio: ["pipe", "ignore", "ignore"] },
) => NotifyProcessChild;

export interface ExecuteNotifyOptions {
  readonly timeoutMs?: number;
  readonly sigkillGraceMs?: number;
  readonly spawnProcess?: NotifySpawner;
}

export function executeNotifyCommand(
  command: string,
  batch: readonly unknown[],
  options?: ExecuteNotifyOptions,
): Promise<NotifyResult> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const sigkillGraceMs = options?.sigkillGraceMs ?? 1000;
  const spawner: NotifySpawner = options?.spawnProcess ?? ((cmd, opts) => spawn(cmd, [], opts));

  return new Promise<NotifyResult>((resolve) => {
    let child: NotifyProcessChild;
    try {
      child = spawner(command, { shell: true, stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve({ ok: false, exitCode: null, timedOut: false });
      return;
    }

    let settled = false;
    let timedOut = false;
    let termTimer: ReturnType<typeof setTimeout> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (termTimer !== null) {
        clearTimeout(termTimer);
        termTimer = null;
      }
      if (killTimer !== null) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    const finish = (result: NotifyResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    termTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {}

      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, sigkillGraceMs);
    }, timeoutMs);

    child.once("exit", (code: number | null) => {
      finish({
        ok: !timedOut && code === 0,
        exitCode: code,
        timedOut,
      });
    });

    child.once("error", () => {
      finish({
        ok: false,
        exitCode: null,
        timedOut,
      });
    });

    try {
      child.stdin?.on?.("error", () => {});
      child.stdin?.write(JSON.stringify(batch));
      child.stdin?.end();
    } catch {
      finish({
        ok: false,
        exitCode: null,
        timedOut,
      });
    }
  });
}

export interface RespawnNotificationPayload {
  readonly reason: "respawn";
  readonly room: string;
  readonly reader: string;
  readonly ts: string;
  readonly message: string;
}

export async function dispatchRespawnNotification(
  command: string | undefined | null,
  payload: RespawnNotificationPayload,
  options?: ExecuteNotifyOptions,
): Promise<NotifyResult | null> {
  if (!command) {
    return null;
  }
  return executeNotifyCommand(command, [payload], options);
}

export function recordConsumerReceipt(
  healthPath: string,
  nowIso: string,
  lastSeq: number,
  ports?: HealthPorts,
): DaemonHealthRecord | null {
  const existing = readHealthRecord(healthPath, ports);
  if (existing === null) {
    return null;
  }
  const updated: DaemonHealthRecord = {
    ...existing,
    consumer_last_ack_at: nowIso,
    consumer_last_delivered_seq: lastSeq,
    updated_at: nowIso,
  };
  writeHealthRecord(healthPath, updated, ports);
  return updated;
}

export interface DispatchNotifyOptions {
  readonly command: string | undefined | null;
  readonly envelopes: readonly Envelope[];
  readonly lastSeq: number | null;
  readonly healthPath: string;
  readonly nowIso: string;
  readonly timeoutMs?: number;
  readonly ports?: HealthPorts;
  readonly spawnProcess?: NotifySpawner;
}

export async function dispatchNotify(options: DispatchNotifyOptions): Promise<NotifyResult | null> {
  if (!options.command || options.envelopes.length === 0) {
    return null;
  }

  const result = await executeNotifyCommand(options.command, options.envelopes, {
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.spawnProcess !== undefined ? { spawnProcess: options.spawnProcess } : {}),
  });

  if (result.ok && result.exitCode === 0 && options.lastSeq !== null) {
    recordConsumerReceipt(options.healthPath, options.nowIso, options.lastSeq, options.ports);
  }

  return result;
}

export interface DeliveryNotificationInput {
  readonly command: string | undefined | null;
  readonly envelopes: readonly Envelope[];
  readonly lastSeq: number | null;
  readonly healthPath: string;
  readonly nowIso: string;
  readonly recentErrors: string[];
  readonly timeoutMs?: number;
  readonly ports?: HealthPorts;
  readonly spawnProcess?: NotifySpawner;
  readonly onErrorsUpdated?: (errors: string[]) => void;
}

export function dispatchDeliveryNotification(
  input: DeliveryNotificationInput,
): Promise<NotifyResult | null> | undefined {
  if (!input.command || input.envelopes.length === 0) {
    return undefined;
  }
  return dispatchNotify({
    command: input.command,
    envelopes: input.envelopes,
    lastSeq: input.lastSeq,
    healthPath: input.healthPath,
    nowIso: input.nowIso,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.ports !== undefined ? { ports: input.ports } : {}),
    ...(input.spawnProcess !== undefined ? { spawnProcess: input.spawnProcess } : {}),
  }).then((res) => {
    if (res !== null && !res.ok) {
      input.recentErrors.push(`notify_command failed at ${input.nowIso}`);
      if (input.recentErrors.length > 20) {
        input.recentErrors.splice(0, input.recentErrors.length - 20);
      }
      input.onErrorsUpdated?.(input.recentErrors);
    }
    return res;
  });
}

export interface ProcessLifecycleController {
  readonly isRunning: () => boolean;
  readonly stop: () => void;
  readonly waitUntilStopped: () => Promise<void>;
  readonly dispose: () => void;
}

export function createProcessLifecycle(onShutdown?: () => void): ProcessLifecycleController {
  let running = true;
  const handleSignal = (): void => {
    running = false;
    onShutdown?.();
  };
  process.once("SIGTERM", handleSignal);
  process.once("SIGINT", handleSignal);
  return {
    isRunning: () => running,
    stop: () => {
      running = false;
      onShutdown?.();
    },
    waitUntilStopped: () =>
      new Promise<void>((resolvePromise) => {
        const interval = setInterval(() => {
          if (!running) {
            clearInterval(interval);
            resolvePromise();
          }
        }, 250);
      }),
    dispose: () => {
      process.removeListener("SIGTERM", handleSignal);
      process.removeListener("SIGINT", handleSignal);
    },
  };
}

export interface ProcessLifecycleRunInput {
  readonly healthPath: string;
  readonly lockFd: number | null;
  readonly room: string;
  readonly reader: string;
  readonly watcher: DaemonWatcher;
  readonly ports?: HealthPorts;
  readonly start: (controller: ProcessLifecycleController) => Promise<void>;
}

export async function runWithProcessLifecycle(input: ProcessLifecycleRunInput): Promise<void> {
  const lifecycle = createProcessLifecycle(() => input.watcher.stop());
  try {
    await input.start(lifecycle);
    await lifecycle.waitUntilStopped();
  } finally {
    lifecycle.dispose();
    input.watcher.stop();
    stampStoppedIfOwned(input.healthPath, process.pid, new Date().toISOString(), input.ports);
    releaseDaemonLock(input.room, input.reader, input.lockFd);
  }
}

export function resolveRoomKey(roomId: string): string {
  const manifestPath = roomManifestPath(roomId);
  if (existsSync(manifestPath)) {
    try {
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (
        typeof manifest === "object" &&
        manifest !== null &&
        "visibility" in manifest &&
        (manifest as { visibility: unknown }).visibility === "public"
      ) {
        return CHATROOM_PUBLIC_KEY;
      }
    } catch {}
  }
  const keyPath = roomKeyPath(roomId);
  if (existsSync(keyPath)) {
    try {
      return readFileSync(keyPath, "utf8").trim();
    } catch {}
  }
  return CHATROOM_PUBLIC_KEY;
}
