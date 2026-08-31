/**
 * Process Command and Tool Output Parsers.
 *
 * Provides parsers for lsof, fuser, ss, ps, and runtime identification.
 */

import type { ProcessDetails } from "./types.ts";

export const RUNTIME_IDENTIFIERS: readonly string[] = [
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
] as const;

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
  const firstToken = tokens[0] ?? "";
  const segments = firstToken.split(/[/\\]/);
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && lastSegment.length > 0) {
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

  const pidStr = parts[0] ?? "";
  const ppidStr = parts[1] ?? "";
  const stateStr = parts[2] ?? "";
  const rssStr = parts[3] ?? "0";

  const pid = Number.parseInt(pidStr, 10);
  const ppid = Number.parseInt(ppidStr, 10);
  const rssKb = Number.parseInt(rssStr, 10);

  if (Number.isNaN(pid) || Number.isNaN(ppid)) return null;

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
  const isOrphaned = ppid === 1 || ppid === 0;
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
