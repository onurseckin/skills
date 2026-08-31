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

export function parseLsofOutput(stdout: string): number[] {
  const pids: number[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && !pids.includes(parsed)) {
      pids.push(parsed);
    }
  }
  return pids;
}

export function parseFuserOutput(output: string): number[] {
  const pids: number[] = [];
  const tokens = output.split(/\s+/);
  for (const token of tokens) {
    const clean = token.replace(/[^0-9]/g, "");
    if (clean.length === 0) continue;
    const parsed = Number.parseInt(clean, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && !pids.includes(parsed)) {
      pids.push(parsed);
    }
  }
  return pids;
}

export function parseSsOutput(stdout: string): number[] {
  const pids: number[] = [];
  const regex = /pid=(\d+)/g;
  let match: RegExpExecArray | null = regex.exec(stdout);
  while (match !== null) {
    const val = match[1];
    if (typeof val === "string") {
      const parsed = Number.parseInt(val, 10);
      if (!Number.isNaN(parsed) && parsed > 0 && !pids.includes(parsed)) {
        pids.push(parsed);
      }
    }
    match = regex.exec(stdout);
  }
  return pids;
}

const RUNTIME_IDENTIFIERS = [
  "node",
  "bun",
  "deno",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "tsx",
  "ts-node",
  "next",
  "vite",
  "webpack",
  "turbopack",
  "esbuild",
  "nodemon",
  "pm2",
];

export function isRuntimeProcessCommand(name: string, command: string): boolean {
  const lowerName = name.toLowerCase();
  const lowerCmd = command.toLowerCase();
  for (const ident of RUNTIME_IDENTIFIERS) {
    if (lowerName === ident) return true;
    if (lowerName.startsWith(`${ident}-`)) return true;
    if (lowerName.endsWith(`/${ident}`)) return true;
    if (lowerCmd.includes(`/${ident} `)) return true;
    if (lowerCmd.includes(`\\${ident} `)) return true;
    if (lowerCmd.startsWith(`${ident} `)) return true;
    if (lowerCmd.includes(`node_modules/.bin/${ident}`)) return true;
    if (lowerCmd.includes(`node_modules/${ident}`)) return true;
    if (lowerCmd.includes(`/${ident}`)) return true;
    if (lowerCmd.includes(`\\${ident}`)) return true;
  }
  return false;
}

export function extractProcessName(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) return "unknown";
  const tokens = trimmed.split(/\s+/);
  const firstToken = typeof tokens[0] === "string" ? tokens[0] : "";
  const segments = firstToken.split(/[/\\]/);
  const lastSegment = segments[segments.length - 1];
  if (typeof lastSegment === "string" && lastSegment.length > 0) {
    return lastSegment;
  }
  if (firstToken.length > 0) {
    return firstToken;
  }
  return "unknown";
}

export function parsePsOutput(stdout: string, fallbackPid: number): ProcessDetails | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const targetLine = lines[0];
  if (typeof targetLine !== "string") return null;

  const parts = targetLine.trim().split(/\s+/);
  if (parts.length < 4) return null;

  const pidStr = typeof parts[0] === "string" ? parts[0] : "";
  const ppidStr = typeof parts[1] === "string" ? parts[1] : "";
  const stateStr = typeof parts[2] === "string" ? parts[2] : "";
  const rssStr = typeof parts[3] === "string" ? parts[3] : "0";

  const pid = Number.parseInt(pidStr, 10);
  const ppid = Number.parseInt(ppidStr, 10);
  const rssKb = Number.parseInt(rssStr, 10);

  if (Number.isNaN(pid)) return null;
  if (Number.isNaN(ppid)) return null;

  let startTime = "";
  let command = "";

  const p4 = parts[4];
  const p5 = parts[5];
  const p6 = parts[6];
  const p7 = parts[7];
  const p8 = parts[8];

  if (
    parts.length >= 10 &&
    typeof p4 === "string" &&
    typeof p5 === "string" &&
    typeof p6 === "string" &&
    typeof p7 === "string" &&
    typeof p8 === "string"
  ) {
    if (/^[A-Za-z]{3}$/.test(p4)) {
      startTime = `${p4} ${p5} ${p6} ${p7} ${p8}`;
      command = parts.slice(9).join(" ");
    } else {
      command = parts.slice(4).join(" ");
    }
  } else {
    command = parts.slice(4).join(" ");
  }

  const finalPid = pid > 0 ? pid : fallbackPid;
  if (command.length === 0) {
    command = `process-${finalPid}`;
  }

  const name = extractProcessName(command);
  const isZombie = stateStr.toUpperCase().includes("Z");
  const isOrphaned = ppid === 1 ? true : ppid === 0 ? true : false;
  const memoryBytes = (Number.isNaN(rssKb) ? 0 : rssKb) * 1024;
  const isRuntimeProcess = isRuntimeProcessCommand(name, command);

  return {
    pid: finalPid,
    ppid,
    name,
    command,
    memoryBytes,
    startTime: startTime.length > 0 ? startTime : "unknown",
    isZombie,
    isOrphaned,
    isRuntimeProcess,
  };
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
