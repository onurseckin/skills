import { existsSync, readFileSync, statSync } from "node:fs";
import {
  daemonHealthPath,
  daemonLockPath,
  isProcessAlive,
  type LockPayload,
} from "../core/index.ts";
import { resolvePolicy, type ChatroomPolicy } from "../policy/index.ts";
import { parseDaemonLockPayload, startDaemon } from "./supervisor.ts";

export interface EnsureDaemonOptions {
  readonly policy?: ChatroomPolicy;
  readonly heartbeatIntervalMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly now?: () => number;
  readonly autoStart?: boolean;
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
  const checkAlive = options.isProcessAlive ?? isProcessAlive;
  const heartbeatInterval = options.heartbeatIntervalMs ?? policy.heartbeat_interval_ms ?? 5000;
  const autoStart = options.autoStart ?? true;

  if (existsSync(lockPath)) {
    let payload: LockPayload | null = null;
    try {
      const raw = readFileSync(lockPath, "utf8");
      payload = parseDaemonLockPayload(raw);
    } catch {}

    if (payload !== null && checkAlive(payload.pid)) {
      if (existsSync(healthPath)) {
        try {
          const stats = statSync(healthPath);
          const now = options.now ? options.now() : Date.now();
          const age = now - stats.mtimeMs;
          if (age <= heartbeatInterval * 2) {
            return {
              status: "running",
              pid: payload.pid,
              healthy: true,
              probedMs: performance.now() - startProbe,
            };
          }
        } catch {}
      } else {
        return {
          status: "running",
          pid: payload.pid,
          healthy: false,
          probedMs: performance.now() - startProbe,
        };
      }
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
  });

  if (startRes.status === "already_running") {
    return {
      status: "running",
      pid: startRes.pid ?? null,
      healthy: true,
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
