import { existsSync, readFileSync, statSync } from "node:fs";
import {
  daemonHealthPath,
  daemonLockPath,
  isProcessAlive,
  type LockPayload,
} from "../core/index.ts";
import { resolvePolicy, type ChatroomPolicy } from "../policy/index.ts";
import { purgeStaleDaemonLockAndHealth, type DaemonLockPorts } from "./lock.ts";
import { parseDaemonLockPayload, startDaemon } from "./supervisor.ts";

export interface EnsureDaemonPorts {
  readonly existsSync?: ((path: string) => boolean) | undefined;
  readonly readFileSync?: ((path: string, encoding: string) => string) | undefined;
  readonly statSync?: ((path: string) => { readonly mtimeMs: number }) | undefined;
  readonly isProcessAlive?: ((pid: number) => boolean) | undefined;
  readonly now?: (() => number) | undefined;
  readonly unlinkSync?: ((path: string) => void) | undefined;
}

export interface EnsureDaemonOptions {
  readonly policy?: ChatroomPolicy;
  readonly heartbeatIntervalMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly now?: () => number;
  readonly autoStart?: boolean;
  readonly ports?: EnsureDaemonPorts;
}

export interface EnsureDaemonResult {
  readonly status: "running" | "started" | "exhausted" | "failed";
  readonly pid?: number | null;
  readonly healthy: boolean;
  readonly probedMs: number;
}

export function ensureDaemon(
  room: string,
  reader: string,
  options: EnsureDaemonOptions = {},
): EnsureDaemonResult {
  const startProbe = performance.now();
  const policy = options.policy ?? resolvePolicy();
  const lockPath = daemonLockPath(room, reader);
  const healthPath = daemonHealthPath(room, reader);
  const exists = options.ports?.existsSync ?? existsSync;
  const readText = options.ports?.readFileSync ?? readFileSync;
  const stat = options.ports?.statSync ?? statSync;
  const checkAlive = options.ports?.isProcessAlive ?? options.isProcessAlive ?? isProcessAlive;
  const getNow = options.ports?.now ?? options.now ?? Date.now;
  const heartbeatInterval = options.heartbeatIntervalMs ?? policy.heartbeat_interval_ms ?? 5000;
  const autoStart = options.autoStart ?? true;

  const lockPorts: DaemonLockPorts = {
    existsSync: options.ports?.existsSync,
    readFileSync: options.ports?.readFileSync,
    unlinkSync: options.ports?.unlinkSync,
    isProcessAlive: checkAlive,
    now: getNow,
  };

  purgeStaleDaemonLockAndHealth(room, reader, lockPorts);

  if (exists(lockPath)) {
    let payload: LockPayload | null = null;
    try {
      const raw = readText(lockPath, "utf8");
      payload = parseDaemonLockPayload(raw);
    } catch {}

    if (payload !== null && checkAlive(payload.pid)) {
      let healthy = false;
      if (exists(healthPath)) {
        try {
          const stats = stat(healthPath);
          const now = getNow();
          const age = now - stats.mtimeMs;
          if (age <= heartbeatInterval * 2) {
            healthy = true;
          }
        } catch {}
      }
      return {
        status: "running",
        pid: payload.pid,
        healthy,
        probedMs: performance.now() - startProbe,
      };
    }
  }

  if (!autoStart) {
    return {
      status: "failed",
      pid: null,
      healthy: false,
      probedMs: performance.now() - startProbe,
    };
  }

  const startRes = startDaemon({
    room,
    reader,
    policy,
    ports: {
      ...options.ports,
      isProcessAlive: checkAlive,
      now: getNow,
    },
  });

  if (startRes.status === "already_running") {
    let healthy = false;
    if (exists(healthPath)) {
      try {
        const stats = stat(healthPath);
        const now = getNow();
        const age = now - stats.mtimeMs;
        if (age <= heartbeatInterval * 2) {
          healthy = true;
        }
      } catch {}
    }
    return {
      status: "running",
      pid: startRes.pid ?? null,
      healthy,
      probedMs: performance.now() - startProbe,
    };
  }

  if (startRes.status === "started") {
    return {
      status: "started",
      pid: startRes.pid ?? null,
      healthy: true,
      probedMs: performance.now() - startProbe,
    };
  }

  if (startRes.status === "exhausted") {
    return {
      status: "exhausted",
      pid: null,
      healthy: false,
      probedMs: performance.now() - startProbe,
    };
  }

  return {
    status: "failed",
    pid: null,
    healthy: false,
    probedMs: performance.now() - startProbe,
  };
}
