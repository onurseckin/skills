/**
 * Docker Engine Unix domain socket HTTP client and candidate path discovery.
 */

import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import * as http from "node:http";
import type { DockerInspectResult } from "./types.ts";
import { parseDockerPsOutput } from "./parser.ts";

/**
 * Default Unix socket path for standard Docker daemon.
 */
export const DEFAULT_DOCKER_SOCKET_PATH = "/var/run/docker.sock";

/**
 * Discovers candidate Docker Unix domain socket paths across macOS, Rootless Linux, and system daemons.
 */
export function getCandidateSocketPaths(): readonly string[] {
  const env = typeof process !== "undefined" ? process.env : {};
  const home = typeof env["HOME"] === "string" && env["HOME"].length > 0 ? env["HOME"] : homedir();
  const candidates: string[] = [];

  // macOS Docker Desktop & OrbStack user sockets
  if (home && home.length > 0) {
    candidates.push(join(home, ".docker", "run", "docker.sock"));
    candidates.push(join(home, ".orbstack", "run", "docker.sock"));
  }

  // Linux Rootless XDG runtime socket
  const xdg = env["XDG_RUNTIME_DIR"];
  if (typeof xdg === "string" && xdg.length > 0) {
    candidates.push(join(xdg, "docker.sock"));
  }

  // Linux Rootless user runtime socket (/run/user/<uid>/docker.sock)
  try {
    const user = userInfo();
    if (user && typeof user.uid === "number" && user.uid >= 0) {
      candidates.push(`/run/user/${user.uid}/docker.sock`);
    }
  } catch {
    // Ignore userInfo lookup error
  }

  // System daemon default socket
  candidates.push(DEFAULT_DOCKER_SOCKET_PATH);

  return candidates;
}

/**
 * Resolves the candidate Docker Unix socket path from custom argument, environment, or discovery.
 */
export function resolveDockerSocketPath(customPath?: string): string {
  if (customPath !== undefined && customPath.trim().length > 0) {
    return customPath.trim();
  }

  const env = typeof process !== "undefined" ? process.env : {};
  const dockerHost = env["DOCKER_HOST"];
  if (typeof dockerHost === "string" && dockerHost.startsWith("unix://")) {
    return dockerHost.slice(7);
  }

  const envSocket = env["DOCKER_SOCKET"];
  if (typeof envSocket === "string" && envSocket.trim().length > 0) {
    return envSocket.trim();
  }

  // Probe candidates for existing socket file
  const candidates = getCandidateSocketPaths();
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Continue to next candidate
    }
  }

  return DEFAULT_DOCKER_SOCKET_PATH;
}

/**
 * Checks if the Docker Unix socket file exists locally.
 */
export function isDockerSocketPresent(socketPath?: string): boolean {
  const resolved = resolveDockerSocketPath(socketPath);
  try {
    return existsSync(resolved);
  } catch {
    return false;
  }
}

/**
 * Inspects running containers directly via Docker Engine Unix domain socket HTTP API.
 */
export function inspectContainersViaSocket(
  socketPath?: string,
  timeoutMs: number = 800,
): Promise<DockerInspectResult> {
  return new Promise((resolve) => {
    const resolvedPath = resolveDockerSocketPath(socketPath);

    if (!isDockerSocketPresent(resolvedPath)) {
      resolve({
        isDockerAvailable: false,
        isDaemonRunning: false,
        error: `Docker socket not found at ${resolvedPath}`,
        containers: [],
      });
      return;
    }

    const req = http.request(
      {
        socketPath: resolvedPath,
        path: "/containers/json",
        method: "GET",
        headers: {
          Host: "docker-daemon",
          Accept: "application/json",
        },
        timeout: timeoutMs,
      },
      (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const code = res.statusCode;
          if (code !== undefined && code >= 200 && code < 300) {
            const containers = parseDockerPsOutput(body);
            resolve({
              isDockerAvailable: true,
              isDaemonRunning: true,
              containers,
            });
          } else {
            const statusStr = code !== undefined ? String(code) : "unknown";
            resolve({
              isDockerAvailable: true,
              isDaemonRunning: false,
              error: `Docker socket returned status ${statusStr}: ${body.slice(0, 200)}`,
              containers: [],
            });
          }
        });
      },
    );

    req.on("error", (err: Error) => {
      resolve({
        isDockerAvailable: false,
        isDaemonRunning: false,
        error: `Docker socket error: ${err.message}`,
        containers: [],
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        isDockerAvailable: false,
        isDaemonRunning: false,
        error: `Docker socket request timed out after ${timeoutMs}ms`,
        containers: [],
      });
    });

    req.end();
  });
}
