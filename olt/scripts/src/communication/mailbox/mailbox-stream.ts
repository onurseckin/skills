import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { withExclusiveLock } from "../locking/index.ts";
import type { MailboxCursor, MailboxEnvelope } from "../types.ts";
import { createEmptyCursor, isMessageProcessed } from "./cursor-tracker.ts";
import { verifyEnvelopeHmac } from "./envelope.ts";
import { escapeQuarantinePayload } from "./quarantine.ts";

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

export interface RotateMailboxOptions {
  readonly maxActiveMessages?: number;
  readonly lockPath?: string;
}

interface QuarantinedItem {
  readonly line: string;
  readonly reason: string;
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function defaultLockPathFor(filePath: string): string {
  const res = resolve(filePath);
  const match = res.match(/(.*)[/\\]\.olt[/\\]mailboxes[/\\]([^/\\]+)[/\\]/);
  if (match && match[1] && match[2]) {
    return join(match[1], ".olt", "locks", "mailboxes", `${match[2]}.lock`);
  }
  return `${filePath}.lock`;
}

export function isValidEnvelopeStructure(obj: unknown): obj is MailboxEnvelope<unknown> {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  const isStr = (k: string): boolean =>
    typeof r[k] === "string" && (r[k] as string).trim().length > 0;
  return (
    isStr("id") &&
    typeof r["sequence"] === "number" &&
    Number.isFinite(r["sequence"]) &&
    isStr("sender_id") &&
    typeof r["sender_role"] === "string" &&
    isStr("recipient_id") &&
    isStr("message_type") &&
    isStr("timestamp") &&
    isStr("correlation_id") &&
    isStr("hmac_signature") &&
    "payload" in r
  );
}

function writeQuarantinedLog(quarantinePath: string, items: readonly QuarantinedItem[]): void {
  if (items.length === 0) return;
  ensureParentDir(quarantinePath);
  const fd = openSync(
    quarantinePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
    0o644,
  );
  try {
    const ts = new Date().toISOString();
    const formatted = items
      .map((i) => `[${ts}] [REASON: ${i.reason}] ${escapeQuarantinePayload(i.line)}\n`)
      .join("");
    writeSync(fd, formatted);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function atomicRewriteInbox(
  inboxPath: string,
  envelopes: readonly MailboxEnvelope<unknown>[],
): void {
  ensureParentDir(inboxPath);
  const tmpPath = `${inboxPath}.${randomUUID()}.tmp`;
  const tmpFd = openSync(
    tmpPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
    0o644,
  );
  try {
    if (envelopes.length > 0) {
      writeSync(tmpFd, envelopes.map((env) => JSON.stringify(env) + "\n").join(""));
    }
    fsyncSync(tmpFd);
  } finally {
    closeSync(tmpFd);
  }
  renameSync(tmpPath, inboxPath);
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

  const writeOp = (): void => {
    ensureParentDir(inboxPath);
    const fd = openSync(
      inboxPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
      0o644,
    );
    try {
      writeSync(fd, JSON.stringify(envelope) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };

  const lock = lockPath?.trim() || defaultLockPathFor(inboxPath);
  withExclusiveLock(lock, envelope.recipient_id || envelope.sender_id || "stream", writeOp);
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
    if (!existsSync(inboxPath)) return { messages: [], quarantinedCount: 0 };
    const rawLines = readFileSync(inboxPath, "utf8").split("\n");
    const validEnvelopes: MailboxEnvelope<unknown>[] = [];
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
        const verifyResult = verifyEnvelopeHmac(parsed, options?.secretKey);
        if (!verifyResult.valid) {
          if (options?.quarantinePath) {
            quarantined.push({
              line,
              reason: `HMAC_VERIFICATION_FAILED: ${verifyResult.error ?? "invalid"}`,
            });
            continue;
          }
          throw new HarnessError("INTEGRITY", `HMAC failed: ${verifyResult.error ?? "invalid"}`);
        }
      }
      validEnvelopes.push(parsed);
    }

    if (quarantined.length > 0 && options?.quarantinePath) {
      writeQuarantinedLog(options.quarantinePath, quarantined);
      atomicRewriteInbox(inboxPath, validEnvelopes);
    }

    const effectiveCursor = cursor ?? createEmptyCursor();
    const unread = validEnvelopes.filter((env) => !isMessageProcessed(env, effectiveCursor));
    return { messages: unread, quarantinedCount: quarantined.length };
  };

  const lock = options?.lockPath?.trim() || defaultLockPathFor(inboxPath);
  return withExclusiveLock(lock, "mailbox-reader", readOp);
}

export function quarantineTornLines(inboxPath: string, quarantinePath: string): number {
  if (typeof quarantinePath !== "string" || quarantinePath.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "quarantinePath must be a non-empty string");
  }
  return readUnreadMessages(inboxPath, null, { quarantinePath }).quarantinedCount;
}

export function rotateMailboxMessages(
  inboxPath: string,
  archivePath: string,
  options?: RotateMailboxOptions,
): number {
  if (typeof inboxPath !== "string" || inboxPath.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "inboxPath must be a non-empty string");
  }
  if (typeof archivePath !== "string" || archivePath.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "archivePath must be a non-empty string");
  }
  if (resolve(inboxPath) === resolve(archivePath)) {
    throw new HarnessError("INVALID_ARGUMENT", "inboxPath and archivePath must be distinct paths");
  }
  const maxActive = options?.maxActiveMessages ?? 1000;
  if (!Number.isInteger(maxActive) || maxActive <= 0) {
    throw new HarnessError("INVALID_ARGUMENT", "maxActiveMessages must be a positive integer");
  }

  const rotateOp = (): number => {
    if (!existsSync(inboxPath)) return 0;
    const lines = readFileSync(inboxPath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const envelopes: MailboxEnvelope<unknown>[] = [];
    for (const line of lines) {
      try {
        const p = JSON.parse(line);
        if (isValidEnvelopeStructure(p)) envelopes.push(p);
      } catch {}
    }
    if (envelopes.length <= maxActive) return 0;
    const excess = envelopes.length - maxActive;
    const toArchive = envelopes.slice(0, excess);
    const toRetain = envelopes.slice(excess);

    ensureParentDir(archivePath);
    const arcFd = openSync(
      archivePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
      0o644,
    );
    try {
      writeSync(arcFd, toArchive.map((env) => JSON.stringify(env) + "\n").join(""));
      fsyncSync(arcFd);
    } finally {
      closeSync(arcFd);
    }
    atomicRewriteInbox(inboxPath, toRetain);
    return excess;
  };

  const lock = options?.lockPath?.trim() || defaultLockPathFor(inboxPath);
  return withExclusiveLock(lock, "mailbox-rotator", rotateOp);
}
