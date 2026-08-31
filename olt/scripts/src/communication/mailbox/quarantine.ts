import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { withExclusiveLock } from "../locking/index.ts";
import {
  ensureMailboxDirectories,
  getInMemoryMailboxDirs,
  isVirtualMailboxPath,
  resolveMailboxPaths,
} from "./mailbox-paths.ts";

export interface QuarantineIngestOptions {
  readonly baseDir?: string;
  readonly lockPath?: string;
}

export interface QuarantinedEntry {
  readonly id: string;
  readonly agentId: string;
  readonly reason: string;
  readonly rawEnvelope: string;
  readonly timestamp: string;
  readonly quarantinePath: string;
}

export interface QuarantinedDeadLetter {
  readonly id: string;
  readonly agentId: string;
  readonly reason: string;
  readonly rawEnvelope: string;
  readonly timestamp: string;
}

export interface SweepQuarantineOptions {
  readonly baseDir?: string;
  readonly agentId?: string;
  readonly maxAgeMs?: number;
  readonly purge?: boolean;
}

export interface SweepQuarantineResult {
  readonly totalEntries: number;
  readonly purgedEntries: number;
  readonly deadLetters: readonly QuarantinedDeadLetter[];
}

const LINE_REGEX = /^\[([^\]]+)\] \[REASON: ([^\]]+)\] (.*)$/u;
const inMemoryQuarantines = new Map<string, string[]>();

export const getInMemoryQuarantine = (p: string): readonly string[] | undefined =>
  inMemoryQuarantines.get(p);
export const setInMemoryQuarantine = (p: string, lines: readonly string[]): void => {
  inMemoryQuarantines.set(p, [...lines]);
};
export const clearInMemoryQuarantines = (): void => {
  inMemoryQuarantines.clear();
};

export function writeInMemoryQuarantine(quarantinePath: string, formatted: string): void {
  const existing = inMemoryQuarantines.get(quarantinePath) ?? [];
  inMemoryQuarantines.set(quarantinePath, [...existing, formatted]);
}

function shouldUseInMemoryQuarantine(p: string): boolean {
  return isVirtualMailboxPath(p) || inMemoryQuarantines.has(p);
}

export function escapeQuarantinePayload(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

export function unescapeQuarantinePayload(str: string): string {
  return str.replace(/\\(\\|r|n)/g, (_, ch) => (ch === "n" ? "\n" : ch === "r" ? "\r" : "\\"));
}

export function ingestToQuarantine(
  agentId: string,
  rawEnvelope: unknown,
  reason: string,
  options?: QuarantineIngestOptions,
): QuarantinedEntry {
  if (typeof agentId !== "string" || !agentId.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "reason must be a non-empty string");
  }
  const paths = resolveMailboxPaths(agentId, options?.baseDir);
  ensureMailboxDirectories(paths);

  const rawStr =
    typeof rawEnvelope === "string"
      ? rawEnvelope
      : typeof rawEnvelope === "object" && rawEnvelope !== null
        ? JSON.stringify(rawEnvelope)
        : String(rawEnvelope);
  const entry: QuarantinedEntry = {
    id: randomUUID(),
    agentId,
    reason,
    rawEnvelope: rawStr,
    timestamp: new Date().toISOString(),
    quarantinePath: paths.quarantinePath,
  };
  const line = `[${entry.timestamp}] [REASON: ${reason}] ${escapeQuarantinePayload(rawStr)}\n`;

  if (shouldUseInMemoryQuarantine(paths.quarantinePath)) {
    writeInMemoryQuarantine(paths.quarantinePath, line);
    return entry;
  }
  const appendOp = (): void => {
    const fd = openSync(
      paths.quarantinePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
      0o644,
    );
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  const lock = options?.lockPath ?? paths.lockPath;
  if (lock?.trim()) withExclusiveLock(lock, "quarantine-ingest", appendOp);
  else appendOp();
  return entry;
}

function parseQuarantineContent(agentId: string, content: string): QuarantinedDeadLetter[] {
  const entries: QuarantinedDeadLetter[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const m = LINE_REGEX.exec(line);
    if (m && m[1] && m[2] && m[3] !== undefined) {
      entries.push({
        id: randomUUID(),
        agentId,
        timestamp: m[1],
        reason: m[2],
        rawEnvelope: unescapeQuarantinePayload(m[3]),
      });
    } else {
      entries.push({
        id: randomUUID(),
        agentId,
        timestamp: new Date().toISOString(),
        reason: "UNKNOWN_CORRUPTION",
        rawEnvelope: line,
      });
    }
  }
  return entries;
}

function formatDeadLetters(entries: readonly QuarantinedDeadLetter[]): string {
  return entries
    .map(
      (k) => `[${k.timestamp}] [REASON: ${k.reason}] ${escapeQuarantinePayload(k.rawEnvelope)}\n`,
    )
    .join("");
}

export function sweepQuarantineDeadLetters(
  options?: SweepQuarantineOptions,
): SweepQuarantineResult {
  const mailboxesDir = options?.baseDir
    ? options.baseDir.endsWith("mailboxes")
      ? resolve(options.baseDir)
      : options.baseDir.includes(".olt")
        ? join(resolve(options.baseDir), "mailboxes")
        : join(resolve(options.baseDir), ".olt", "mailboxes")
    : join(resolve(process.cwd()), ".olt", "mailboxes");
  const agentIds = new Set<string>();

  if (options?.agentId) {
    agentIds.add(options.agentId);
  } else {
    for (const dir of getInMemoryMailboxDirs()) {
      const m = dir.match(new RegExp("[/\\\\].olt[/\\\\]mailboxes[/\\\\]([^/\\\\]+)$"));
      if (m?.[1] && !m[1].startsWith(".")) agentIds.add(m[1]);
    }
    if (existsSync(mailboxesDir)) {
      try {
        for (const entry of readdirSync(mailboxesDir)) {
          try {
            if (statSync(join(mailboxesDir, entry)).isDirectory()) agentIds.add(entry);
          } catch {}
        }
      } catch {}
    }
  }

  const deadLetters: QuarantinedDeadLetter[] = [];
  let totalEntries = 0;
  let purgedEntries = 0;
  const now = Date.now();
  const maxAge = options?.maxAgeMs;

  for (const agentId of agentIds) {
    const paths = resolveMailboxPaths(agentId, options?.baseDir);
    const isMem = shouldUseInMemoryQuarantine(paths.quarantinePath);
    let rawContent = "";
    if (isMem) {
      const memLines = inMemoryQuarantines.get(paths.quarantinePath);
      if (!memLines || memLines.length === 0) continue;
      rawContent = memLines.join("");
    } else {
      if (!existsSync(paths.quarantinePath)) continue;
      rawContent = readFileSync(paths.quarantinePath, "utf8");
    }

    const entries = parseQuarantineContent(agentId, rawContent);
    totalEntries += entries.length;
    const kept: QuarantinedDeadLetter[] = [];
    for (const e of entries) {
      const t = new Date(e.timestamp).getTime();
      if (maxAge !== undefined ? Number.isFinite(t) && now - t >= maxAge : true)
        deadLetters.push(e);
      else kept.push(e);
    }

    if (options?.purge) {
      if (isMem) {
        if (kept.length === 0) inMemoryQuarantines.delete(paths.quarantinePath);
        else inMemoryQuarantines.set(paths.quarantinePath, [formatDeadLetters(kept)]);
        purgedEntries += entries.length - kept.length;
      } else {
        const purgeOp = (): void => {
          if (kept.length === 0) truncateSync(paths.quarantinePath, 0);
          else writeFileSync(paths.quarantinePath, formatDeadLetters(kept), "utf8");
          purgedEntries += entries.length - kept.length;
        };
        if (paths.lockPath?.trim()) withExclusiveLock(paths.lockPath, "quarantine-purge", purgeOp);
        else purgeOp();
      }
    }
  }

  return { totalEntries, purgedEntries, deadLetters };
}
