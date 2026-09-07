import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";
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

export interface LeaseOptions {
  readonly now?: string;
  readonly ttlMs?: number;
  readonly leaseId?: string;
}

export interface LeaseResult {
  readonly cursor: ReaderCursor;
  readonly leaseId: string | null;
  readonly messages: readonly LogEnvelope[];
}

function scanFromDirectory(logDir: string, fromSeq: number, limit: number): LogEnvelope[] {
  if (!fs.existsSync(logDir)) {
    return [];
  }
  const files = fs
    .readdirSync(logDir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();

  const collected: LogEnvelope[] = [];
  let expectedSeq = fromSeq;

  for (const file of files) {
    const filePath = join(logDir, file);
    const content = fs.readFileSync(filePath, "utf8");
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

function scanFromInput(
  log: readonly LogEnvelope[] | LogSource | string,
  fromSeq: number,
  limit: number,
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
    return scanFromDirectory(log, fromSeq, limit);
  }

  if ("scan" in log && typeof log.scan === "function") {
    return [...log.scan(fromSeq, limit)];
  }
  if ("readRange" in log && typeof log.readRange === "function") {
    return [...log.readRange(fromSeq, fromSeq + limit - 1)];
  }
  if ("getEnvelopes" in log && typeof log.getEnvelopes === "function") {
    const all = log.getEnvelopes();
    return scanFromInput(all, fromSeq, limit);
  }

  return [];
}

export function leaseNext(
  cursor: ReaderCursor,
  log: readonly LogEnvelope[] | LogSource | string,
  limit: number,
  options?: LeaseOptions,
): LeaseResult {
  const effectiveLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 500));
  const now = options?.now ?? new Date().toISOString();
  const ttlMs = options?.ttlMs ?? 120000;

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

  const rawMessages = scanFromInput(log, startSeq, nextLimit);

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

  const leaseId = options?.leaseId ?? `L-${randomUUID().slice(0, 8)}`;
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
