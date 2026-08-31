import { constants, existsSync, readFileSync } from "node:fs";
import { HarnessError } from "../../core/errors/index.ts";
import { withExclusiveLock } from "../locking/index.ts";
import type { MailboxCursor, MailboxEnvelope } from "../types.ts";
import { createEmptyCursor, isMessageProcessed } from "./cursor-tracker.ts";
import { verifyEnvelopeHmac } from "./envelope.ts";
import {
  atomicRewriteInbox,
  defaultLockPathFor,
  isValidEnvelopeStructure,
  writeAndSync,
} from "./mailbox-stream-io.ts";
import {
  appendInMemoryMessage,
  clearInMemoryMailboxStore,
  getInMemoryMailbox,
  getInMemoryQuarantine,
  isInMemoryStreamMode,
  setInMemoryMailbox,
  setInMemoryStreamMode,
  shouldUseInMemory,
  writeInMemoryQuarantine,
} from "./mailbox-stream-store.ts";
import { escapeQuarantinePayload } from "./quarantine.ts";

export {
  clearInMemoryMailboxStore,
  getInMemoryMailbox,
  getInMemoryQuarantine,
  isInMemoryStreamMode,
  setInMemoryMailbox,
  setInMemoryStreamMode,
};
export { isValidEnvelopeStructure } from "./mailbox-stream-io.ts";
export { rotateMailboxMessages, type RotateMailboxOptions } from "./mailbox-rotate.ts";

export interface ReadUnreadMessagesOptions {
  readonly quarantinePath?: string;
  readonly verifyHmac?: boolean;
  readonly secretKey?: string;
  readonly lockPath?: string;
}

export interface ReadUnreadMessagesResult {
  readonly messages: readonly MailboxEnvelope<unknown>[];
  readonly quarantinedCount: number;
}

interface QuarantinedItem {
  readonly line: string;
  readonly reason: string;
}

function writeQuarantinedLog(quarantinePath: string, items: readonly QuarantinedItem[]): void {
  if (items.length === 0) return;
  const ts = new Date().toISOString();
  const formatted = items
    .map((i) => `[${ts}] [REASON: ${i.reason}] ${escapeQuarantinePayload(i.line)}\n`)
    .join("");
  if (shouldUseInMemory(quarantinePath)) {
    writeInMemoryQuarantine(quarantinePath, formatted);
    return;
  }
  writeAndSync(
    quarantinePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
    formatted,
  );
}

export function appendMailboxMessage(
  inboxPath: string,
  envelope: MailboxEnvelope<unknown>,
  lockPath?: string,
): void {
  if (typeof inboxPath !== "string" || inboxPath.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "inboxPath must be a non-empty string");
  }
  if (!isValidEnvelopeStructure(envelope)) {
    throw new HarnessError("INVALID_ARGUMENT", "Invalid MailboxEnvelope structure");
  }
  if (shouldUseInMemory(inboxPath)) {
    appendInMemoryMessage(inboxPath, envelope);
    return;
  }
  const lock = lockPath?.trim() || defaultLockPathFor(inboxPath);
  withExclusiveLock(lock, envelope.recipient_id || envelope.sender_id || "stream", () => {
    writeAndSync(
      inboxPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
      JSON.stringify(envelope) + "\n",
    );
  });
}

function parseMailboxLines(
  inboxPath: string,
  rawLines: readonly string[],
  options?: ReadUnreadMessagesOptions,
): { valid: MailboxEnvelope<unknown>[]; quarantined: QuarantinedItem[] } {
  const valid: MailboxEnvelope<unknown>[] = [];
  const quarantined: QuarantinedItem[] = [];
  for (const line of rawLines) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (options?.quarantinePath) {
        quarantined.push({ line, reason: "MALFORMED_JSON_SYNTAX" });
        continue;
      }
      throw new HarnessError("INTEGRITY", `Malformed JSON in mailbox '${inboxPath}'`);
    }
    if (!isValidEnvelopeStructure(parsed)) {
      if (options?.quarantinePath) {
        quarantined.push({ line, reason: "INVALID_ENVELOPE_STRUCTURE" });
        continue;
      }
      throw new HarnessError("INTEGRITY", `Invalid envelope structure in mailbox '${inboxPath}'`);
    }
    if (options?.verifyHmac) {
      const v = verifyEnvelopeHmac(parsed, options?.secretKey);
      if (!v.valid) {
        if (options?.quarantinePath) {
          quarantined.push({ line, reason: `HMAC_VERIFICATION_FAILED: ${v.error ?? "invalid"}` });
          continue;
        }
        throw new HarnessError("INTEGRITY", `HMAC failed: ${v.error ?? "invalid"}`);
      }
    }
    valid.push(parsed);
  }
  return { valid, quarantined };
}

export function readUnreadMessages(
  inboxPath: string,
  cursor?: MailboxCursor | null,
  options?: ReadUnreadMessagesOptions,
): ReadUnreadMessagesResult {
  if (typeof inboxPath !== "string" || inboxPath.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "inboxPath must be a non-empty string");
  }
  const readOp = (): ReadUnreadMessagesResult => {
    let rawLines: readonly string[];
    if (shouldUseInMemory(inboxPath)) {
      if (!getInMemoryMailbox(inboxPath)) return { messages: [], quarantinedCount: 0 };
      rawLines = getInMemoryMailbox(inboxPath) ?? [];
    } else {
      if (!existsSync(inboxPath)) return { messages: [], quarantinedCount: 0 };
      rawLines = readFileSync(inboxPath, "utf8").split("\n");
    }
    const { valid, quarantined } = parseMailboxLines(inboxPath, rawLines, options);
    if (quarantined.length > 0 && options?.quarantinePath) {
      writeQuarantinedLog(options.quarantinePath, quarantined);
      atomicRewriteInbox(inboxPath, valid);
    }
    const effectiveCursor = cursor ?? createEmptyCursor();
    const unread = valid.filter((env) => !isMessageProcessed(env, effectiveCursor));
    return { messages: unread, quarantinedCount: quarantined.length };
  };
  if (shouldUseInMemory(inboxPath)) return readOp();
  const lock = options?.lockPath?.trim() || defaultLockPathFor(inboxPath);
  return withExclusiveLock(lock, "mailbox-reader", readOp);
}

export function quarantineTornLines(inboxPath: string, quarantinePath: string): number {
  if (typeof quarantinePath !== "string" || quarantinePath.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "quarantinePath must be a non-empty string");
  }
  return readUnreadMessages(inboxPath, null, { quarantinePath }).quarantinedCount;
}
