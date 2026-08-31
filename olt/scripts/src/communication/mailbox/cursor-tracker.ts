import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { withExclusiveLock } from "../locking/index.ts";
import type { MailboxCursor, MailboxEnvelope } from "../types.ts";
import { isVirtualMailboxPath } from "./mailbox-paths.ts";

export const DEFAULT_MAX_SEEN_IDS = 5000;

const inMemoryCursors = new Map<string, MailboxCursor>();
export const getInMemoryCursor = (p: string) => inMemoryCursors.get(p);
export const setInMemoryCursor = (p: string, cur: MailboxCursor) => {
  inMemoryCursors.set(p, { ...cur });
};
export const clearInMemoryCursors = () => {
  inMemoryCursors.clear();
};
export const shouldUseInMemoryCursor = (p: string): boolean =>
  isVirtualMailboxPath(p) || inMemoryCursors.has(p);

export function isValidCursorPayload(value: unknown): value is MailboxCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>,
    seq = c.last_read_sequence;
  if (typeof seq !== "number" || !Number.isFinite(seq) || seq < 0) return false;
  if (typeof c.last_read_id !== "string" || !Array.isArray(c.seen_ids)) return false;
  if (c.seen_ids.some((item) => typeof item !== "string")) return false;
  return typeof c.updated_at === "string";
}

export function createEmptyCursor(): MailboxCursor {
  return {
    last_read_sequence: 0,
    last_read_id: "",
    seen_ids: [],
    updated_at: new Date().toISOString(),
  };
}

function quarantineCorruptCursor(cursorPath: string): void {
  try {
    const corruptPath = `${cursorPath}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`;
    fs.renameSync(cursorPath, corruptPath);
  } catch {}
}

function writeCursorAtomically(cursorPath: string, cursor: MailboxCursor): void {
  if (shouldUseInMemoryCursor(cursorPath)) {
    inMemoryCursors.set(cursorPath, { ...cursor });
    return;
  }
  const dir = dirname(cursorPath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      throw new HarnessError(
        "INTEGRITY",
        `Failed to create directory '${dir}' for cursor: ${String(e)}`,
      );
    }
  }
  const tempPath = join(dir, `.cursor-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(cursor, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tempPath, cursorPath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    throw new HarnessError(
      "INTEGRITY",
      `Failed to save mailbox cursor to '${cursorPath}': ${String(error)}`,
    );
  }
}

function computeAdvancedCursor(
  baseCursor: MailboxCursor,
  messages: readonly MailboxEnvelope<unknown>[],
  maxSeenIds: number = DEFAULT_MAX_SEEN_IDS,
): MailboxCursor {
  let maxSeq = baseCursor.last_read_sequence;
  const seenSet = new Set<string>(baseCursor.seen_ids);
  for (const msg of messages) {
    if (msg.sequence > maxSeq) maxSeq = msg.sequence;
    seenSet.delete(msg.id);
    seenSet.add(msg.id);
  }
  const mergedSeen = Array.from(seenSet);
  const boundedSeen = mergedSeen.length > maxSeenIds ? mergedSeen.slice(-maxSeenIds) : mergedSeen;
  const lastId = messages.length > 0 ? messages[messages.length - 1]!.id : baseCursor.last_read_id;
  return {
    last_read_sequence: maxSeq,
    last_read_id: lastId,
    seen_ids: boundedSeen,
    updated_at: new Date().toISOString(),
  };
}

export function loadMailboxCursor(cursorPath: string): MailboxCursor {
  if (!cursorPath || typeof cursorPath !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "cursorPath must be a non-empty string");
  if (shouldUseInMemoryCursor(cursorPath))
    return inMemoryCursors.get(cursorPath) ?? createEmptyCursor();
  if (!fs.existsSync(cursorPath)) return createEmptyCursor();
  let rawContent: string;
  try {
    rawContent = fs.readFileSync(cursorPath, "utf8");
  } catch (e) {
    throw new HarnessError("INTEGRITY", `Failed to read cursor '${cursorPath}': ${String(e)}`);
  }
  const trimmed = rawContent.trim();
  if (trimmed.length === 0) return createEmptyCursor();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    quarantineCorruptCursor(cursorPath);
    return createEmptyCursor();
  }
  if (!isValidCursorPayload(parsed)) {
    quarantineCorruptCursor(cursorPath);
    return createEmptyCursor();
  }
  return {
    last_read_sequence: parsed.last_read_sequence,
    last_read_id: parsed.last_read_id,
    seen_ids: [...parsed.seen_ids],
    updated_at: parsed.updated_at,
  };
}

export function saveMailboxCursor(
  cursorPath: string,
  cursor: MailboxCursor,
  lockPath?: string,
): void {
  if (!cursorPath || typeof cursorPath !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "cursorPath must be a non-empty string");
  if (!isValidCursorPayload(cursor))
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxCursor object provided to saveMailboxCursor",
    );
  if (shouldUseInMemoryCursor(cursorPath)) {
    inMemoryCursors.set(cursorPath, { ...cursor });
    return;
  }
  const execute = (): void => writeCursorAtomically(cursorPath, cursor);
  if (lockPath?.trim()) withExclusiveLock(lockPath, `cursor-tracker-${process.pid}`, execute);
  else execute();
}

export function isMessageProcessed(
  message: MailboxEnvelope<unknown>,
  cursor: MailboxCursor,
): boolean {
  if (
    !message ||
    typeof message !== "object" ||
    typeof message.id !== "string" ||
    typeof message.sequence !== "number"
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxEnvelope provided to isMessageProcessed",
    );
  }
  if (!isValidCursorPayload(cursor))
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxCursor provided to isMessageProcessed",
    );
  if (cursor.seen_ids.includes(message.id)) return true;
  return message.sequence > 0 && message.sequence <= cursor.last_read_sequence;
}

export function advanceMailboxCursor(
  cursorPath: string,
  processedMessage: MailboxEnvelope<unknown>,
  currentCursor?: MailboxCursor | null,
  lockPath?: string,
): MailboxCursor {
  if (!cursorPath || typeof cursorPath !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "cursorPath must be a non-empty string");
  if (
    !processedMessage ||
    typeof processedMessage !== "object" ||
    typeof processedMessage.id !== "string" ||
    typeof processedMessage.sequence !== "number"
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxEnvelope provided to advanceMailboxCursor",
    );
  }
  if (
    currentCursor !== undefined &&
    currentCursor !== null &&
    !isValidCursorPayload(currentCursor)
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid currentCursor provided to advanceMailboxCursor",
    );
  }
  const execute = (): MailboxCursor => {
    const base = currentCursor ?? loadMailboxCursor(cursorPath),
      updated = computeAdvancedCursor(base, [processedMessage]);
    writeCursorAtomically(cursorPath, updated);
    return updated;
  };
  if (shouldUseInMemoryCursor(cursorPath)) return execute();
  if (lockPath?.trim())
    return withExclusiveLock(lockPath, `cursor-tracker-${process.pid}`, execute);
  return execute();
}

export function advanceMailboxCursorBatch(
  cursorPath: string,
  processedMessages: readonly MailboxEnvelope<unknown>[],
  currentCursor?: MailboxCursor | null,
  lockPath?: string,
): MailboxCursor {
  if (!cursorPath || typeof cursorPath !== "string")
    throw new HarnessError("INVALID_ARGUMENT", "cursorPath must be a non-empty string");
  if (!Array.isArray(processedMessages))
    throw new HarnessError("INVALID_ARGUMENT", "processedMessages must be an array");
  for (const msg of processedMessages) {
    if (
      !msg ||
      typeof msg !== "object" ||
      typeof msg.id !== "string" ||
      typeof msg.sequence !== "number"
    ) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Invalid MailboxEnvelope in processedMessages batch",
      );
    }
  }
  if (
    currentCursor !== undefined &&
    currentCursor !== null &&
    !isValidCursorPayload(currentCursor)
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid currentCursor provided to advanceMailboxCursorBatch",
    );
  }
  const execute = (): MailboxCursor => {
    const base = currentCursor ?? loadMailboxCursor(cursorPath);
    if (processedMessages.length === 0) return base;
    const updated = computeAdvancedCursor(base, processedMessages);
    writeCursorAtomically(cursorPath, updated);
    return updated;
  };
  if (shouldUseInMemoryCursor(cursorPath)) return execute();
  if (lockPath?.trim())
    return withExclusiveLock(lockPath, `cursor-tracker-${process.pid}`, execute);
  return execute();
}
