import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { basename, dirname, join } from "node:path";
import { ChatError } from "../core/index.ts";
import {
  assertCursorInvariants,
  computeCursorChecksum,
  type HeldLease,
  type ReaderCursor,
} from "./model.ts";

export interface LogEnvelope {
  readonly v: number;
  readonly id: string;
  readonly room: string;
  readonly seq: number;
  readonly ts: string;
  readonly sender: {
    readonly id: string;
    readonly role: string;
    readonly host: string;
    readonly repo_hint?: string;
    readonly pid?: number;
  };
  readonly kind: string;
  readonly thread?: string;
  readonly reply_to?: string | null;
  readonly mentions?: readonly string[];
  readonly text?: string;
  readonly body?: {
    readonly schema: string;
    readonly data: Record<string, unknown>;
  };
  readonly key_fingerprint: string;
  redelivery_count?: number;
  readonly sig: string;
}

export interface LogSource {
  readonly scan?: (fromSeq: number, limit: number) => readonly LogEnvelope[];
  readonly readRange?: (fromSeq: number, toSeq: number) => readonly LogEnvelope[];
  readonly getEnvelopes?: () => readonly LogEnvelope[];
}

export interface LeaseFsStats {
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface LeaseFsPorts {
  readonly existsSync?: (path: string) => boolean;
  readonly statSync?: (path: string) => LeaseFsStats | undefined;
  readonly readdirSync?: (path: string) => readonly (string | { readonly name: string })[];
  readonly readFileSync?: (path: string, encoding: string) => string | Uint8Array;
}

export interface LeaseOptions {
  readonly now?: string;
  readonly ttlMs?: number;
  readonly leaseId?: string;
  readonly fs?: LeaseFsPorts;
}

export interface LeaseResult {
  readonly cursor: ReaderCursor;
  readonly leaseId: string | null;
  readonly messages: readonly LogEnvelope[];
}

function fsExists(targetPath: string, fsPorts?: LeaseFsPorts): boolean {
  try {
    return fsPorts?.existsSync ? fsPorts.existsSync(targetPath) : fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

function fsStat(targetPath: string, fsPorts?: LeaseFsPorts): LeaseFsStats | undefined {
  try {
    return fsPorts?.statSync ? fsPorts.statSync(targetPath) : fs.statSync(targetPath);
  } catch {
    return undefined;
  }
}

function fsRead(targetPath: string, fsPorts?: LeaseFsPorts): string {
  try {
    const raw = fsPorts?.readFileSync
      ? fsPorts.readFileSync(targetPath, "utf8")
      : fs.readFileSync(targetPath, "utf8");
    return typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  } catch {
    return "";
  }
}

function fsReaddir(dirPath: string, fsPorts?: LeaseFsPorts): readonly string[] {
  try {
    const entries = fsPorts?.readdirSync ? fsPorts.readdirSync(dirPath) : fs.readdirSync(dirPath);
    return entries.map((entry) => (typeof entry === "string" ? entry : entry.name));
  } catch {
    return [];
  }
}

function scanFromFiles(
  filePaths: readonly string[],
  fromSeq: number,
  limit: number,
  fsPorts?: LeaseFsPorts,
): LogEnvelope[] {
  const collected: LogEnvelope[] = [];
  let expectedSeq = fromSeq;

  for (const filePath of filePaths) {
    if (!fsExists(filePath, fsPorts)) {
      continue;
    }
    const content = fsRead(filePath, fsPorts);
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        const envelope = JSON.parse(trimmed) as LogEnvelope;
        if (envelope && typeof envelope === "object" && typeof envelope.seq === "number") {
          if (envelope.seq === expectedSeq && collected.length < limit) {
            collected.push(envelope);
            expectedSeq++;
          }
        }
      } catch {}
      if (collected.length >= limit) {
        return collected;
      }
    }
  }

  return collected;
}

export function scanFromDirectory(
  logDir: string,
  fromSeq: number,
  limit: number,
  fsPorts?: LeaseFsPorts,
): LogEnvelope[] {
  if (!fsExists(logDir, fsPorts)) {
    return [];
  }
  const stat = fsStat(logDir, fsPorts);
  if (!stat || !stat.isDirectory()) {
    throw new ChatError("INVALID_STATE", `Expected directory at path '${logDir}'`);
  }
  const files = fsReaddir(logDir, fsPorts)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();

  const filePaths = files.map((file) => join(logDir, file));
  return scanFromFiles(filePaths, fromSeq, limit, fsPorts);
}

export function scanFromFile(
  filePath: string,
  fromSeq: number,
  limit: number,
  fsPorts?: LeaseFsPorts,
): LogEnvelope[] {
  if (!fsExists(filePath, fsPorts)) {
    return [];
  }
  const stat = fsStat(filePath, fsPorts);
  if (!stat || !stat.isFile()) {
    throw new ChatError("INVALID_STATE", `Expected file at path '${filePath}'`);
  }

  const fileName = basename(filePath);
  const dir = dirname(filePath);
  const spoolMatch = fileName.match(/^(.+\.out)\.jsonl$/);

  if (spoolMatch) {
    const prefix = spoolMatch[1]!;
    const prefixWithDot = `${prefix}.`;
    const suffix = ".jsonl";
    const dirEntries = fsReaddir(dir, fsPorts);
    const segments: { readonly num: number; readonly path: string }[] = [];

    for (const entry of dirEntries) {
      if (entry.startsWith(prefixWithDot) && entry.endsWith(suffix)) {
        const middle = entry.slice(prefixWithDot.length, entry.length - suffix.length);
        if (/^\d+$/.test(middle)) {
          const num = Number.parseInt(middle, 10);
          if (Number.isSafeInteger(num) && num >= 0) {
            segments.push({ num, path: join(dir, entry) });
          }
        }
      }
    }

    segments.sort((a, b) => a.num - b.num);
    const filesToScan = [...segments.map((s) => s.path), filePath];
    return scanFromFiles(filesToScan, fromSeq, limit, fsPorts);
  }

  return scanFromFiles([filePath], fromSeq, limit, fsPorts);
}

function scanFromInput(
  log: readonly LogEnvelope[] | LogSource | string,
  fromSeq: number,
  limit: number,
  fsPorts?: LeaseFsPorts,
): LogEnvelope[] {
  if (Array.isArray(log)) {
    const sorted = [...log].sort((a, b) => a.seq - b.seq);
    const result: LogEnvelope[] = [];
    let expectedSeq = fromSeq;
    for (const env of sorted) {
      if (env.seq === expectedSeq && result.length < limit) {
        result.push(env);
        expectedSeq++;
      }
    }
    return result;
  }

  if (typeof log === "string") {
    if (!fsExists(log, fsPorts)) {
      return [];
    }
    const stat = fsStat(log, fsPorts);
    if (stat?.isDirectory()) {
      return scanFromDirectory(log, fromSeq, limit, fsPorts);
    }
    if (stat?.isFile()) {
      return scanFromFile(log, fromSeq, limit, fsPorts);
    }
    throw new ChatError("INVALID_STATE", `Expected file or directory at '${log}'`);
  }

  if ("scan" in log && typeof log.scan === "function") {
    return [...log.scan(fromSeq, limit)];
  }
  if ("readRange" in log && typeof log.readRange === "function") {
    return [...log.readRange(fromSeq, fromSeq + limit - 1)];
  }
  if ("getEnvelopes" in log && typeof log.getEnvelopes === "function") {
    const all = log.getEnvelopes();
    return scanFromInput(all, fromSeq, limit, fsPorts);
  }

  return [];
}

export function leaseNext(
  cursor: ReaderCursor,
  log: readonly LogEnvelope[] | LogSource | string,
  limit: number,
  options: LeaseOptions = {},
): LeaseResult {
  const effectiveLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 500));
  const now = options.now ?? new Date().toISOString();
  const ttlMs = options.ttlMs ?? 120000;

  const activeHeld: HeldLease[] = [];
  const expiredHeld: HeldLease[] = [];

  for (const h of cursor.held) {
    if (h.expires_at <= now) {
      expiredHeld.push(h);
    } else {
      activeHeld.push(h);
    }
  }

  activeHeld.sort((a, b) => a.from - b.from);

  let startSeq = cursor.contiguous_seq + 1;
  for (const h of activeHeld) {
    if (startSeq >= h.from && startSeq <= h.to) {
      startSeq = h.to + 1;
    }
  }

  let nextLimit = effectiveLimit;
  for (const h of activeHeld) {
    if (h.from > startSeq) {
      const gap = h.from - startSeq;
      if (gap < nextLimit) {
        nextLimit = gap;
      }
      break;
    }
  }

  const rawMessages = scanFromInput(log, startSeq, nextLimit, options.fs);

  if (rawMessages.length === 0) {
    if (activeHeld.length !== cursor.held.length) {
      const unsigned: Omit<ReaderCursor, "checksum"> = {
        v: 1,
        room: cursor.room,
        reader: cursor.reader,
        contiguous_seq: cursor.contiguous_seq,
        held: activeHeld,
        acked_above: cursor.acked_above,
        last_ack_at: cursor.last_ack_at,
        last_ack_kind: cursor.last_ack_kind,
        updated_at: now,
      };
      const checksum = computeCursorChecksum(unsigned);
      const updatedCursor: ReaderCursor = {
        ...unsigned,
        checksum,
      };
      assertCursorInvariants(updatedCursor);
      return {
        cursor: updatedCursor,
        leaseId: null,
        messages: [],
      };
    }
    return {
      cursor,
      leaseId: null,
      messages: [],
    };
  }

  const from = rawMessages[0]!.seq;
  const to = rawMessages[rawMessages.length - 1]!.seq;

  let maxExpiredAttempt = 0;
  for (const exp of expiredHeld) {
    if (exp.from <= to && exp.to >= from) {
      if (exp.attempt > maxExpiredAttempt) {
        maxExpiredAttempt = exp.attempt;
      }
    }
  }
  const attempt = maxExpiredAttempt > 0 ? maxExpiredAttempt + 1 : 1;
  const redeliveryCount = attempt > 1 ? attempt - 1 : 0;

  const deliveredMessages: LogEnvelope[] = rawMessages.map((msg) => ({
    ...msg,
    redelivery_count: redeliveryCount,
  }));

  const leaseId = options.leaseId ?? `L-${randomUUID().slice(0, 8)}`;
  const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();

  const newLease: HeldLease = {
    lease: leaseId,
    from,
    to,
    issued_at: now,
    expires_at: expiresAt,
    attempt,
  };

  const updatedHeld = [...activeHeld, newLease].sort((a, b) => a.from - b.from);

  const unsigned: Omit<ReaderCursor, "checksum"> = {
    v: 1,
    room: cursor.room,
    reader: cursor.reader,
    contiguous_seq: cursor.contiguous_seq,
    held: updatedHeld,
    acked_above: cursor.acked_above,
    last_ack_at: cursor.last_ack_at,
    last_ack_kind: cursor.last_ack_kind,
    updated_at: now,
  };

  const checksum = computeCursorChecksum(unsigned);
  const nextCursor: ReaderCursor = {
    ...unsigned,
    checksum,
  };

  assertCursorInvariants(nextCursor);

  return {
    cursor: nextCursor,
    leaseId,
    messages: deliveredMessages,
  };
}
