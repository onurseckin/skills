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
import { ensureMailboxDirectories, resolveMailboxPaths } from "./mailbox-paths.ts";

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

export function escapeQuarantinePayload(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

export function unescapeQuarantinePayload(str: string): string {
  return str.replace(/\\(\\|r|n)/g, (_, ch) => {
    if (ch === "n") return "\n";
    if (ch === "r") return "\r";
    if (ch === "\\") return "\\";
    return ch;
  });
}

export function ingestToQuarantine(
  agentId: string,
  rawEnvelope: unknown,
  reason: string,
  options?: QuarantineIngestOptions,
): QuarantinedEntry {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
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

  const entryId = randomUUID();
  const timestamp = new Date().toISOString();
  const formattedLine = `[${timestamp}] [REASON: ${reason}] ${escapeQuarantinePayload(rawStr)}\n`;

  const appendOp = (): void => {
    const fd = openSync(
      paths.quarantinePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
      0o644,
    );
    try {
      writeSync(fd, formattedLine);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };

  const lockPath = options?.lockPath ?? paths.lockPath;
  if (lockPath && lockPath.trim().length > 0) {
    withExclusiveLock(lockPath, "quarantine-ingest", appendOp);
  } else {
    appendOp();
  }

  return {
    id: entryId,
    agentId,
    reason,
    rawEnvelope: rawStr,
    timestamp,
    quarantinePath: paths.quarantinePath,
  };
}

function parseQuarantineFile(agentId: string, filePath: string): QuarantinedDeadLetter[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const entries: QuarantinedDeadLetter[] = [];
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue;
    const match = LINE_REGEX.exec(line);
    if (match && match[1] && match[2] && match[3] !== undefined) {
      entries.push({
        id: randomUUID(),
        agentId,
        timestamp: match[1],
        reason: match[2],
        rawEnvelope: unescapeQuarantinePayload(match[3]),
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

export function sweepQuarantineDeadLetters(
  options?: SweepQuarantineOptions,
): SweepQuarantineResult {
  const effectiveBase = resolve(options?.baseDir ?? process.cwd());
  const mailboxesDir = join(effectiveBase, ".olt", "mailboxes");
  const agentIds: string[] = [];
  if (options?.agentId) {
    agentIds.push(options.agentId);
  } else if (existsSync(mailboxesDir)) {
    try {
      for (const entry of readdirSync(mailboxesDir)) {
        try {
          if (statSync(join(mailboxesDir, entry)).isDirectory()) agentIds.push(entry);
        } catch {}
      }
    } catch {}
  }

  const allDeadLetters: QuarantinedDeadLetter[] = [];
  let totalEntries = 0;
  let purgedEntries = 0;
  const now = Date.now();
  const maxAge = options?.maxAgeMs;

  for (const agentId of agentIds) {
    const paths = resolveMailboxPaths(agentId, options?.baseDir);
    if (!existsSync(paths.quarantinePath)) continue;

    const entries = parseQuarantineFile(agentId, paths.quarantinePath);
    totalEntries += entries.length;
    const kept: QuarantinedDeadLetter[] = [];
    for (const entry of entries) {
      const entryTime = new Date(entry.timestamp).getTime();
      const isExpired =
        maxAge !== undefined ? Number.isFinite(entryTime) && now - entryTime >= maxAge : true;
      if (isExpired) {
        allDeadLetters.push(entry);
      } else {
        kept.push(entry);
      }
    }

    if (options?.purge) {
      const lockPath = paths.lockPath;
      const purgeOp = (): void => {
        if (kept.length === 0) {
          truncateSync(paths.quarantinePath, 0);
          purgedEntries += entries.length;
        } else {
          const newContent = kept
            .map(
              (k) =>
                `[${k.timestamp}] [REASON: ${k.reason}] ${escapeQuarantinePayload(k.rawEnvelope)}\n`,
            )
            .join("");
          writeFileSync(paths.quarantinePath, newContent, "utf8");
          purgedEntries += entries.length - kept.length;
        }
      };
      if (lockPath && lockPath.trim().length > 0) {
        withExclusiveLock(lockPath, "quarantine-purge", purgeOp);
      } else {
        purgeOp();
      }
    }
  }

  return { totalEntries, purgedEntries, deadLetters: allDeadLetters };
}
