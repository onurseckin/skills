/**
 * Dev Server Instance Starter & Port Acquisition Verifier Subsystem.
 *
 * Spawns new dev server instances and deterministically verifies TCP port binding
 * within configurable timeouts.
 */

import { Socket } from "node:net";
import { spawn } from "node:child_process";
import type { ServerStartOptions, ServerStartResult } from "./types.ts";

export const DEFAULT_BIND_TIMEOUT_MS = 5000;
export const DEFAULT_BIND_POLL_INTERVAL_MS = 100;

/**
 * Checks if a TCP port is currently open and listening.
 */
export function checkTcpPort(port: number, host?: string): Promise<boolean> {
  let targetHost = "127.0.0.1";
  if (host !== undefined && host !== null && host.length > 0) {
    targetHost = host;
  }

  return new Promise<boolean>((resolvePromise) => {
    const socket = new Socket();
    let isResolved = false;

    const cleanup = (): void => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(400);

    socket.once("connect", () => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        resolvePromise(true);
      }
    });

    socket.once("timeout", () => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        resolvePromise(false);
      }
    });

    socket.once("error", () => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        resolvePromise(false);
      }
    });

    socket.connect(port, targetHost);
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Default child process spawner when spawnServerFn is not supplied.
 */
async function defaultSpawn(options: ServerStartOptions): Promise<{ pid: number }> {
  let command = "bun";
  if (options !== undefined && options !== null && options.command !== undefined && options.command.length > 0) {
    command = options.command;
  }

  let args: readonly string[] = ["run", "dev"];
  if (options !== undefined && options !== null && options.args !== undefined) {
    args = options.args;
  }

  let cwd = process.cwd();
  if (options !== undefined && options !== null && options.cwd !== undefined && options.cwd.length > 0) {
    cwd = options.cwd;
  }

  let env = process.env;
  if (options !== undefined && options !== null && options.env !== undefined) {
    env = { ...process.env, ...options.env };
  }

  const child = spawn(command, [...args], {
    cwd,
    env,
    stdio: "ignore",
    detached: true,
  });

  child.unref();

  if (child.pid === undefined) {
    throw new Error(`Failed to spawn server process for command: ${command}`);
  }
  if (child.pid <= 0) {
    throw new Error(`Invalid process PID spawned for command: ${command}`);
  }

  return { pid: child.pid };
}

/**
 * Initiates a new dev server instance and verifies that all target ports are acquired.
 */
export async function startServer(options: ServerStartOptions): Promise<ServerStartResult> {
  const startTime = Date.now();

  let bindTimeoutMs = DEFAULT_BIND_TIMEOUT_MS;
  if (options !== undefined && options !== null && typeof options.bindTimeoutMs === "number") {
    bindTimeoutMs = options.bindTimeoutMs;
  }

  let bindPollIntervalMs = DEFAULT_BIND_POLL_INTERVAL_MS;
  if (options !== undefined && options !== null && typeof options.bindPollIntervalMs === "number") {
    bindPollIntervalMs = options.bindPollIntervalMs;
  }

  let portChecker = checkTcpPort;
  if (options !== undefined && options !== null && options.portChecker !== undefined) {
    portChecker = options.portChecker;
  }

  let spawnServer = defaultSpawn;
  if (options !== undefined && options !== null && options.spawnServerFn !== undefined) {
    spawnServer = options.spawnServerFn;
  }

  let sleep = defaultSleep;
  if (options !== undefined && options !== null && options.sleepFn !== undefined) {
    sleep = options.sleepFn;
  }

  // Determine target ports to verify
  const targetPorts: number[] = [];
  if (options.portConfigurations !== undefined && options.portConfigurations !== null && options.portConfigurations.length > 0) {
    for (const pc of options.portConfigurations) {
      if (!targetPorts.includes(pc.port)) {
        targetPorts.push(pc.port);
      }
    }
  } else if (options.primaryPort !== undefined && options.primaryPort !== null) {
    targetPorts.push(options.primaryPort);
  }

  let pid = 0;
  try {
    const spawned = await spawnServer(options);
    pid = spawned.pid;
  } catch (err: unknown) {
    let errorMessage = String(err);
    if (err instanceof Error) {
      errorMessage = err.message;
    }
    return {
      pid: 0,
      boundPorts: [],
      started: false,
      durationMs: Date.now() - startTime,
      error: `Failed to initiate server process: ${errorMessage}`,
    };
  }

  // If no ports to verify, consider successfully started immediately
  if (targetPorts.length === 0) {
    return {
      pid,
      boundPorts: [],
      started: true,
      durationMs: Date.now() - startTime,
    };
  }

  // Poll until all target ports are bound or timeout is reached
  const deadline = Date.now() + bindTimeoutMs;
  const boundPortsSet = new Set<number>();

  while (Date.now() < deadline) {
    for (const port of targetPorts) {
      if (!boundPortsSet.has(port)) {
        const isBound = await portChecker(port);
        if (isBound) {
          boundPortsSet.add(port);
        }
      }
    }

    if (boundPortsSet.size === targetPorts.length) {
      return {
        pid,
        boundPorts: Array.from(boundPortsSet),
        started: true,
        durationMs: Date.now() - startTime,
      };
    }

    await sleep(bindPollIntervalMs);
  }

  // If failed to bind, clean up the spawned process
  if (pid > 0) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore cleanup error
    }
  }

  const missingPorts = targetPorts.filter((p) => !boundPortsSet.has(p));
  return {
    pid,
    boundPorts: Array.from(boundPortsSet),
    started: false,
    durationMs: Date.now() - startTime,
    error: `Dev server failed to bind target ports [${missingPorts.join(", ")}] within ${bindTimeoutMs}ms.`,
  };
}
