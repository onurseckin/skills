/**
 * Process inspection, port occupancy discovery, and process tree analysis.
 */

import { spawn } from "node:child_process";
import type {
  CommandExecutionResult,
  PortProcessOccupancy,
  ProcessDetails,
  ProcessInspectorOptions,
} from "./types.ts";
import {
  extractProcessName,
  isRuntimeProcessCommand,
  parseFuserOutput,
  parseLsofOutput,
  parsePsOutput,
  parseSsOutput,
  RUNTIME_IDENTIFIERS,
} from "./parser.ts";

export {
  extractProcessName,
  isRuntimeProcessCommand,
  parseFuserOutput,
  parseLsofOutput,
  parsePsOutput,
  parseSsOutput,
  RUNTIME_IDENTIFIERS,
};

export async function defaultCommandExecutor(
  command: string,
  args: readonly string[],
): Promise<CommandExecutionResult> {
  return await new Promise<CommandExecutionResult>((resolve) => {
    try {
      const child = spawn(command, [...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

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
      child.on("close", (exitCode: number | null) => {
        resolve({ stdout, stderr, exitCode: typeof exitCode === "number" ? exitCode : 0 });
      });
      child.on("error", (err: Error) => {
        resolve({ stdout: "", stderr: err.message, exitCode: 127 });
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({ stdout: "", stderr: message, exitCode: 127 });
    }
  });
}

export async function findPidsOnPort(
  port: number,
  options?: ProcessInspectorOptions,
): Promise<number[]> {
  const exec =
    typeof options !== "undefined" && typeof options.execCommand === "function"
      ? options.execCommand
      : defaultCommandExecutor;

  // 1. Try lsof
  const lsofRes = await exec("lsof", ["-i", `:${port}`, "-t", "-sTCP:LISTEN"]);
  if (lsofRes.exitCode === 0 && lsofRes.stdout.trim().length > 0) {
    return parseLsofOutput(lsofRes.stdout);
  }

  // 2. Try fuser
  const fuserRes = await exec("fuser", [`${port}/tcp`]);
  const fuserCombined = `${fuserRes.stdout} ${fuserRes.stderr}`.trim();
  if (fuserCombined.length > 0) {
    const fuserPids = parseFuserOutput(fuserCombined);
    if (fuserPids.length > 0) return fuserPids;
  }

  // 3. Try ss
  const ssRes = await exec("ss", ["-tlpn", `sport = :${port}`]);
  if (ssRes.stdout.trim().length > 0) {
    const ssPids = parseSsOutput(ssRes.stdout);
    if (ssPids.length > 0) return ssPids;
  }

  return [];
}

export async function getProcessDetails(
  pid: number,
  options?: ProcessInspectorOptions,
): Promise<ProcessDetails | null> {
  const exec =
    typeof options !== "undefined" && typeof options.execCommand === "function"
      ? options.execCommand
      : defaultCommandExecutor;
  const psRes = await exec("ps", [
    "-p",
    String(pid),
    "-o",
    "pid=,ppid=,state=,rss=,lstart=,command=",
  ]);

  if (psRes.exitCode === 0 && psRes.stdout.trim().length > 0) {
    const details = parsePsOutput(psRes.stdout, pid);
    if (details !== null) return details;
  }

  // Fallback without lstart if ps failed with error code or empty
  const fallbackRes = await exec("ps", [
    "-p",
    String(pid),
    "-o",
    "pid=,ppid=,state=,rss=,command=",
  ]);
  if (fallbackRes.exitCode === 0 && fallbackRes.stdout.trim().length > 0) {
    return parsePsOutput(fallbackRes.stdout, pid);
  }

  return null;
}

export async function inspectPortOccupancy(
  port: number,
  options?: ProcessInspectorOptions,
): Promise<PortProcessOccupancy> {
  const pids = await findPidsOnPort(port, options);
  const processes: ProcessDetails[] = [];

  for (const pid of pids) {
    const details = await getProcessDetails(pid, options);
    if (details !== null) {
      processes.push(details);
    } else {
      processes.push({
        pid,
        ppid: 1,
        name: "unknown",
        command: `unknown (pid ${pid})`,
        memoryBytes: 0,
        startTime: "unknown",
        isZombie: false,
        isOrphaned: true,
        isRuntimeProcess: false,
      });
    }
  }

  return {
    port,
    pids,
    processes,
  };
}

export async function inspectProcessesOnPorts(
  ports: readonly number[],
  options?: ProcessInspectorOptions,
): Promise<PortProcessOccupancy[]> {
  return await Promise.all(ports.map((port) => inspectPortOccupancy(port, options)));
}
