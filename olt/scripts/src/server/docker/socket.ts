import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import * as http from "node:http";
import type { DockerInspectResult } from "./types.ts";
import { parseDockerPsOutput } from "./parser.ts";

/**
 * Default Unix socket path for Docker daemon.
 */
export const DEFAULT_DOCKER_SOCKET_PATH = "/var/run/docker.sock";

/**
 * Resolves the candidate Docker Unix socket path from environment or default.
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
  timeoutMs: number = 3000,
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
