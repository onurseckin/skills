import { spawnSync } from "node:child_process";
import type { GitRunner, GitRunnerResult, SyncRunner } from "./types.ts";

export function boundedEvidenceCause(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 240);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return String(error).slice(0, 240);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
      return descriptor.value.slice(0, 240);
    }
  } catch {}
  return "unknown error";
}

export const defaultGitRunner: GitRunner = (
  args: readonly string[],
  cwd: string,
): GitRunnerResult => {
  try {
    const result = spawnSync("git", [...args], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    return {
      status: 1,
      stdout: "",
      stderr: boundedEvidenceCause(error),
    };
  }
};

export const defaultSyncRunner: SyncRunner = (command: string, cwd: string): GitRunnerResult => {
  try {
    const parts = command.trim().split(/\s+/);
    let executable = "bun";
    if (parts.length > 0) {
      const firstPart = parts[0];
      if (firstPart !== undefined && firstPart.length > 0) {
        executable = firstPart;
      }
    }
    const args = parts.slice(1);
    const result = spawnSync(executable, args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    return {
      status: 1,
      stdout: "",
      stderr: boundedEvidenceCause(error),
    };
  }
};
