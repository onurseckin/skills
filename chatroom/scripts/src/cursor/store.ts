import * as fs from "node:fs";
import {
  ChatError,
  type LockOptions,
  readerLockPath,
  withLock,
  writeAtomic,
} from "../core/index.ts";
import {
  absorbAckedAbove,
  assertCursorInvariants,
  computeCursorChecksum,
  createInitialCursor,
  type ReaderCursor,
} from "./model.ts";

export interface LoadedCursor {
  readonly cursor: ReaderCursor;
  readonly checksum: string;
}

export type { LockOptions };

function resolveRoomAndReader(
  cursorPath: string,
  options?: { room?: string; reader?: string },
): { room: string; reader: string } {
  if (options?.room && options?.reader) {
    return { room: options.room, reader: options.reader };
  }
  const match = cursorPath.match(/(?:^|\/)rooms\/([^/]+)\/readers\/([^/]+)\.cursor\.json$/);
  if (match && match[1] && match[2]) {
    return {
      room: options?.room ?? match[1],
      reader: options?.reader ?? match[2],
    };
  }
  const readerMatch = cursorPath.match(/([^/]+)\.cursor\.json$/);
  const reader = options?.reader ?? (readerMatch && readerMatch[1] ? readerMatch[1] : undefined);
  const room = options?.room ?? undefined;
  if (!room || !reader) {
    throw new ChatError(
      "INVALID_STATE",
      `Cannot resolve room and reader from cursor path '${cursorPath}' without explicit options`,
    );
  }
  return { room, reader };
}

export function withReaderLock<T>(
  room: string,
  reader: string,
  fn: () => Promise<T>,
  options?: LockOptions,
): Promise<T>;
export function withReaderLock<T>(
  room: string,
  reader: string,
  fn: () => T,
  options?: LockOptions,
): T;
export function withReaderLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options?: LockOptions,
): Promise<T>;
export function withReaderLock<T>(lockPath: string, fn: () => T, options?: LockOptions): T;
export function withReaderLock<T>(
  roomOrPath: string,
  readerOrFn: string | (() => T | Promise<T>),
  fnOrOptions?: (() => T | Promise<T>) | LockOptions,
  options?: LockOptions,
): T | Promise<T> {
  if (typeof readerOrFn === "string") {
    const lockPath = readerLockPath(roomOrPath, readerOrFn);
    const action = fnOrOptions as () => T | Promise<T>;
    return withLock(lockPath, action, options);
  }
  const lockPath = roomOrPath;
  if (!lockPath.endsWith(".lock") && !lockPath.includes("/") && !lockPath.includes("\\")) {
    throw new ChatError(
      "INVALID_ARGUMENT",
      "withReaderLock requires room and readerId or an absolute lockPath",
    );
  }
  const action = readerOrFn;
  const lockOptions = fnOrOptions as LockOptions | undefined;
  return withLock(lockPath, action, lockOptions);
}

export function loadCursor(
  cursorPath: string,
  options?: { room?: string; reader?: string },
): LoadedCursor {
  if (!fs.existsSync(cursorPath)) {
    const { room, reader } = resolveRoomAndReader(cursorPath, options);
    const cursor = createInitialCursor(room, reader);
    return {
      cursor,
      checksum: cursor.checksum,
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(cursorPath, "utf8");
  } catch (error) {
    throw new ChatError(
      "CURSOR_CORRUPT",
      `Failed to read cursor file at ${cursorPath}: ${String(error)}`,
    );
  }

  if (content.trim().length === 0) {
    throw new ChatError("CURSOR_CORRUPT", `Cursor file at ${cursorPath} is empty`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new ChatError(
      "CURSOR_CORRUPT",
      `Cursor file at ${cursorPath} is not valid JSON: ${String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ChatError("CURSOR_CORRUPT", `Cursor file at ${cursorPath} is not a JSON object`);
  }

  const candidate = parsed as ReaderCursor;
  assertCursorInvariants(candidate);

  return {
    cursor: candidate,
    checksum: candidate.checksum,
  };
}

export function saveCursorCas(
  cursorPath: string,
  next: ReaderCursor,
  expected: string,
): LoadedCursor {
  if (typeof expected !== "string" || expected.length === 0) {
    throw new ChatError("INVALID_ARGUMENT", "Expected checksum token is required for CAS update");
  }

  if (fs.existsSync(cursorPath)) {
    let content: string;
    try {
      content = fs.readFileSync(cursorPath, "utf8");
    } catch (error) {
      throw new ChatError(
        "CURSOR_CORRUPT",
        `Failed to re-read cursor file at ${cursorPath}: ${String(error)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new ChatError(
        "CURSOR_CORRUPT",
        `Cursor file at ${cursorPath} is corrupt: ${String(error)}`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ChatError("CURSOR_CORRUPT", `Cursor file at ${cursorPath} is not a JSON object`);
    }
    const current = parsed as ReaderCursor;
    assertCursorInvariants(current);
    if (current.checksum !== expected) {
      throw new ChatError(
        "CURSOR_CONFLICT",
        `Cursor CAS conflict on ${cursorPath}: expected ${expected}, current ${current.checksum}`,
        { expected, actual: current.checksum },
      );
    }
  } else {
    const freshCursor = createInitialCursor(next.room, next.reader, next.updated_at);
    const initialExpectedPrefix = "sha256:";
    if (!expected.startsWith(initialExpectedPrefix)) {
      throw new ChatError(
        "CURSOR_CONFLICT",
        `Cursor CAS conflict on ${cursorPath}: file absent, expected token invalid: ${expected}`,
        { expected },
      );
    }
    if (
      expected !== freshCursor.checksum &&
      (next.contiguous_seq !== 0 || next.held.length !== 0 || next.acked_above.length !== 0)
    ) {
      throw new ChatError(
        "CURSOR_CONFLICT",
        `Cursor CAS conflict on ${cursorPath}: file absent, expected ${expected} does not match initial state`,
        { expected },
      );
    }
  }

  const { contiguous_seq: absorbedContiguous, acked_above: absorbedAbove } = absorbAckedAbove(
    next.contiguous_seq,
    next.acked_above,
  );

  const timestamp = new Date().toISOString();
  const unsigned: Omit<ReaderCursor, "checksum"> = {
    v: 1,
    room: next.room,
    reader: next.reader,
    contiguous_seq: absorbedContiguous,
    held: next.held,
    acked_above: absorbedAbove,
    last_ack_at: next.last_ack_at,
    updated_at: timestamp,
  };

  const newChecksum = computeCursorChecksum(unsigned);
  const finalCursor: ReaderCursor = {
    ...unsigned,
    checksum: newChecksum,
  };

  assertCursorInvariants(finalCursor);
  const serialized = JSON.stringify(finalCursor);
  writeAtomic(cursorPath, serialized);

  return {
    cursor: finalCursor,
    checksum: finalCursor.checksum,
  };
}
