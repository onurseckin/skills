import { createHash } from "node:crypto";
import { canonicalJson, ChatError } from "../core/index.ts";

export { ChatError };

export interface HeldLease {
  readonly lease: string;
  readonly from: number;
  readonly to: number;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly attempt: number;
}

export interface ReaderCursor {
  readonly v: 1;
  readonly room: string;
  readonly reader: string;
  readonly contiguous_seq: number;
  readonly held: readonly HeldLease[];
  readonly acked_above: readonly number[];
  readonly last_ack_at: string | null;
  readonly updated_at: string;
  readonly checksum: string;
}

export { canonicalJson };

export function computeCursorChecksum(
  cursor: Omit<ReaderCursor, "checksum"> | ReaderCursor,
): string {
  const payload: Record<string, unknown> = {
    v: cursor.v,
    room: cursor.room,
    reader: cursor.reader,
    contiguous_seq: cursor.contiguous_seq,
    held: cursor.held,
    acked_above: cursor.acked_above,
    last_ack_at: cursor.last_ack_at,
    updated_at: cursor.updated_at,
  };
  const canonical = canonicalJson(payload);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${digest}`;
}

export function absorbAckedAbove(
  contiguousSeq: number,
  ackedAbove: readonly number[],
): { contiguous_seq: number; acked_above: number[] } {
  let contiguous = contiguousSeq;
  const remaining = new Set(ackedAbove);
  while (remaining.has(contiguous + 1)) {
    contiguous += 1;
    remaining.delete(contiguous);
  }
  const sortedRemaining = Array.from(remaining)
    .filter((seq) => seq > contiguous)
    .sort((a, b) => a - b);
  return {
    contiguous_seq: contiguous,
    acked_above: sortedRemaining,
  };
}

export function assertCursorInvariants(cursor: ReaderCursor): void {
  if (cursor.v !== 1) {
    throw new ChatError(
      "CURSOR_CORRUPT",
      `Invalid cursor version: ${String(cursor.v)}, expected 1`,
    );
  }
  if (typeof cursor.room !== "string" || cursor.room.length === 0) {
    throw new ChatError("CURSOR_CORRUPT", "Cursor room must be a non-empty string");
  }
  if (typeof cursor.reader !== "string" || cursor.reader.length === 0) {
    throw new ChatError("CURSOR_CORRUPT", "Cursor reader must be a non-empty string");
  }
  if (!Number.isInteger(cursor.contiguous_seq) || cursor.contiguous_seq < 0) {
    throw new ChatError(
      "CURSOR_CORRUPT",
      `contiguous_seq must be non-negative integer, got ${String(cursor.contiguous_seq)}`,
    );
  }
  if (!Array.isArray(cursor.held)) {
    throw new ChatError("CURSOR_CORRUPT", "held must be an array");
  }
  for (let i = 0; i < cursor.held.length; i++) {
    const h = cursor.held[i];
    if (!h || typeof h !== "object") {
      throw new ChatError("CURSOR_CORRUPT", `held[${i}] must be an object`);
    }
    if (typeof h.lease !== "string" || h.lease.length === 0) {
      throw new ChatError("CURSOR_CORRUPT", `held[${i}].lease must be a non-empty string`);
    }
    if (!Number.isInteger(h.from) || !Number.isInteger(h.to) || h.from > h.to) {
      throw new ChatError(
        "CURSOR_CORRUPT",
        `held[${i}] has invalid range [${String(h.from)}, ${String(h.to)}]`,
      );
    }
    if (h.from <= cursor.contiguous_seq) {
      throw new ChatError(
        "CURSOR_CORRUPT",
        `held[${i}].from (${h.from}) must be strictly above contiguous_seq (${cursor.contiguous_seq})`,
      );
    }
    if (!Number.isInteger(h.attempt) || h.attempt < 1) {
      throw new ChatError("CURSOR_CORRUPT", `held[${i}].attempt must be an integer >= 1`);
    }
    if (typeof h.issued_at !== "string" || typeof h.expires_at !== "string") {
      throw new ChatError("CURSOR_CORRUPT", `held[${i}] must have string issued_at and expires_at`);
    }
    if (i > 0) {
      const prev = cursor.held[i - 1];
      if (prev && prev.to >= h.from) {
        throw new ChatError(
          "CURSOR_CORRUPT",
          `held ranges must be disjoint and sorted: held[${i - 1}].to (${prev.to}) >= held[${i}].from (${h.from})`,
        );
      }
    }
  }
  if (!Array.isArray(cursor.acked_above)) {
    throw new ChatError("CURSOR_CORRUPT", "acked_above must be an array");
  }
  if (cursor.acked_above.length > 4096) {
    throw new ChatError(
      "CURSOR_CORRUPT",
      `acked_above length exceeds 4096: ${cursor.acked_above.length}`,
    );
  }
  for (let i = 0; i < cursor.acked_above.length; i++) {
    const seq = cursor.acked_above[i];
    if (!Number.isInteger(seq)) {
      throw new ChatError("CURSOR_CORRUPT", `acked_above[${i}] must be an integer`);
    }
    if (seq <= cursor.contiguous_seq) {
      throw new ChatError(
        "CURSOR_CORRUPT",
        `acked_above[${i}] (${seq}) must be strictly above contiguous_seq (${cursor.contiguous_seq})`,
      );
    }
    for (const h of cursor.held) {
      if (seq >= h.from && seq <= h.to) {
        throw new ChatError(
          "CURSOR_CORRUPT",
          `acked_above[${i}] (${seq}) falls inside held range [${h.from}, ${h.to}]`,
        );
      }
    }
    if (i > 0) {
      const prevSeq = cursor.acked_above[i - 1];
      if (prevSeq !== undefined && prevSeq >= seq) {
        throw new ChatError(
          "CURSOR_CORRUPT",
          `acked_above must be strictly ascending: ${prevSeq} >= ${seq}`,
        );
      }
    }
  }
  if (cursor.acked_above.includes(cursor.contiguous_seq + 1)) {
    throw new ChatError(
      "CURSOR_CORRUPT",
      `contiguous_seq + 1 (${cursor.contiguous_seq + 1}) was not absorbed from acked_above`,
    );
  }
  if (cursor.last_ack_at !== null && typeof cursor.last_ack_at !== "string") {
    throw new ChatError("CURSOR_CORRUPT", "last_ack_at must be string or null");
  }
  if (typeof cursor.updated_at !== "string" || cursor.updated_at.length === 0) {
    throw new ChatError("CURSOR_CORRUPT", "updated_at must be a non-empty string");
  }
  if (typeof cursor.checksum !== "string" || cursor.checksum.length === 0) {
    throw new ChatError("CURSOR_CORRUPT", "checksum must be a non-empty string");
  }
  const expectedChecksum = computeCursorChecksum(cursor);
  if (cursor.checksum !== expectedChecksum) {
    throw new ChatError(
      "CURSOR_CORRUPT",
      `Checksum mismatch: stored ${cursor.checksum}, expected ${expectedChecksum}`,
    );
  }
}

export function createInitialCursor(room: string, reader: string, now?: string): ReaderCursor {
  const timestamp = now ?? new Date().toISOString();
  const unsigned: Omit<ReaderCursor, "checksum"> = {
    v: 1,
    room,
    reader,
    contiguous_seq: 0,
    held: [],
    acked_above: [],
    last_ack_at: null,
    updated_at: timestamp,
  };
  const checksum = computeCursorChecksum(unsigned);
  const cursor: ReaderCursor = {
    ...unsigned,
    checksum,
  };
  assertCursorInvariants(cursor);
  return cursor;
}
