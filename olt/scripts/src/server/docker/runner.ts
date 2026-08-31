/**
 * Synchronous and Asynchronous Docker Process Runners.
 *
 * Provides non-blocking async process spawning and error classification.
 */

import { spawn, spawnSync } from "node:child_process";
import type { DockerRunner, DockerRunnerResult } from "./types.ts";

export const DEFAULT_DOCKER_TIMEOUT_MS = 4000;
export const DEFAULT_ASYNC_DOCKER_TIMEOUT_MS = 2500;

/**
 * Standard synchronous Docker CLI runner using node:child_process.spawnSync.
 */
export const defaultDockerRunner: DockerRunner = (
  command: string,
  args: readonly string[],
): DockerRunnerResult => {
  try {
    const result = spawnSync(command, Array.from(args), {
      timeout: DEFAULT_DOCKER_TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.error !== undefined) {
      return {
        status: result.status ?? null,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        error: result.error,
      };
    }

    return {
      status: result.status ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      status: null,
      stdout: "",
      stderr: error.message,
      error,
    };
  }
};

/**
 * Non-blocking asynchronous Docker CLI runner using node:child_process.spawn.
 */
export function execDockerAsync(
  command: string,
  args: readonly string[],
  timeoutMs: number = DEFAULT_ASYNC_DOCKER_TIMEOUT_MS,
): Promise<DockerRunnerResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, Array.from(args), {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            child.kill("SIGKILL");
          } catch {
            // Ignore kill error
          }
          resolve({
            status: null,
            stdout,
            stderr: "Docker command timed out",
            error: new Error(`Docker command timed out after ${timeoutMs}ms`),
          });
        }
      }, timeoutMs);

      if (typeof timer.unref === "function") {
        timer.unref();
      }

      if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });
      }
      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });
      }

      child.on("close", (code: number | null) => {
        if (!settled) {
          settled = true;
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          resolve({
            status: code,
            stdout,
            stderr,
          });
        }
      });

      child.on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          resolve({
            status: null,
            stdout: "",
            stderr: err.message,
            error: err,
          });
        }
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      resolve({
        status: null,
        stdout: "",
        stderr: error.message,
        error,
      });
    }
  });
}

/**
 * Checks whether an error or stderr message indicates Docker daemon absence or disconnect.
 */
export function isDockerDaemonUnavailableError(stderr: string, error?: Error | undefined): boolean {
  if (error !== undefined) {
    const errorObj = error as unknown as Record<string, unknown>;
    const code = errorObj["code"];
    if (code === "ENOENT" || code === "ECONNREFUSED" || code === "ETIMEDOUT") return true;

    const msg = error.message.toLowerCase();
    if (
      msg.includes("enoent") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("cannot connect to the docker daemon") ||
      msg.includes("is the docker daemon running") ||
      msg.includes("command not found")
    ) {
      return true;
    }
  }

  const lower = stderr.toLowerCase();
  return (
    lower.includes("cannot connect to the docker daemon") ||
    lower.includes("is the docker daemon running") ||
    lower.includes("docker: command not found") ||
    lower.includes("command not found") ||
    lower.includes("no such file or directory") ||
    lower.includes("error during connect") ||
    lower.includes("permission denied") ||
    lower.includes("daemon is not running") ||
    lower.includes("connection refused")
  );
}
