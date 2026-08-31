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
import { isVirtualMailboxPath, registerInMemoryMailboxDir } from "./mailbox-paths.ts";
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

const inMemoryMailboxes = new Map<string, string[]>();
const inMemoryQuarantines = new Map<string, string[]>();
let inMemoryStreamModeEnabled = false;

export const setInMemoryStreamMode = (e: boolean): void => {
  inMemoryStreamModeEnabled = e;
};
export const isInMemoryStreamMode = (): boolean => inMemoryStreamModeEnabled;
export const getInMemoryMailbox = (p: string): readonly string[] | undefined =>
  inMemoryMailboxes.get(p);
export const setInMemoryMailbox = (p: string, lines: readonly string[]): void => {
  inMemoryMailboxes.set(p, [...lines]);
};
export const getInMemoryQuarantine = (p: string): readonly string[] | undefined =>
  inMemoryQuarantines.get(p);
export const clearInMemoryMailboxStore = (): void => {
  inMemoryMailboxes.clear();
  inMemoryQuarantines.clear();
};

const shouldUseInMemory = (p: string): boolean =>
  inMemoryStreamModeEnabled || isVirtualMailboxPath(p) || inMemoryMailboxes.has(p);

function getDirname(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash > 0 ? p.slice(0, lastSlash) : p;
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function defaultLockPathFor(filePath: string): string {
  const res = resolve(filePath);
  const m = res.match(/(.*)[/\\]\.olt[/\\]mailboxes[/\\]([^/\\]+)[/\\]/);
  return m?.[1] && m?.[2]
    ? join(m[1], ".olt", "locks", "mailboxes", `${m[2]}.lock`)
    : `${filePath}.lock`;
}

function writeAndSync(filePath: string, flags: number, content: string): void {
  ensureParentDir(filePath);
  const fd = openSync(filePath, flags, 0o644);
  try {
    if (content.length > 0) writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
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
  const ts = new Date().toISOString();
  const formatted = items
    .map((i) => `[${ts}] [REASON: ${i.reason}] ${escapeQuarantinePayload(i.line)}\n`)
    .join("");
  if (shouldUseInMemory(quarantinePath)) {
    const existing = inMemoryQuarantines.get(quarantinePath) ?? [];
    inMemoryQuarantines.set(quarantinePath, [...existing, formatted]);
    return;
  }
  writeAndSync(
    quarantinePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
    formatted,
  );
}

function atomicRewriteInbox(
  inboxPath: string,
  envelopes: readonly MailboxEnvelope<unknown>[],
): void {
  if (shouldUseInMemory(inboxPath)) {
    inMemoryMailboxes.set(
      inboxPath,
      envelopes.map((env) => JSON.stringify(env)),
    );
    return;
  }
  const tmp = `${inboxPath}.${randomUUID()}.tmp`;
  writeAndSync(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
    envelopes.map((env) => JSON.stringify(env) + "\n").join(""),
  );
  renameSync(tmp, inboxPath);
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
    registerInMemoryMailboxDir(getDirname(inboxPath));
    const existing = inMemoryMailboxes.get(inboxPath) ?? [];
    inMemoryMailboxes.set(inboxPath, [...existing, JSON.stringify(envelope)]);
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
      if (!inMemoryMailboxes.has(inboxPath)) return { messages: [], quarantinedCount: 0 };
      rawLines = inMemoryMailboxes.get(inboxPath) ?? [];
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
    const isMem = shouldUseInMemory(inboxPath);
    let rawLines: readonly string[] = [];
    if (isMem) {
      if (!inMemoryMailboxes.has(inboxPath)) return 0;
      rawLines = inMemoryMailboxes.get(inboxPath) ?? [];
    } else {
      if (!existsSync(inboxPath)) return 0;
      rawLines = readFileSync(inboxPath, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    }
    const envelopes: MailboxEnvelope<unknown>[] = [];
    for (const line of rawLines) {
      try {
        const p = JSON.parse(line);
        if (isValidEnvelopeStructure(p)) envelopes.push(p);
      } catch {}
    }
    if (envelopes.length <= maxActive) return 0;
    const excess = envelopes.length - maxActive;
    const toArchive = envelopes.slice(0, excess);
    const toRetain = envelopes.slice(excess);
    if (isMem || shouldUseInMemory(archivePath)) {
      const existing = inMemoryMailboxes.get(archivePath) ?? [];
      inMemoryMailboxes.set(archivePath, [...existing, ...toArchive.map((e) => JSON.stringify(e))]);
      inMemoryMailboxes.set(
        inboxPath,
        toRetain.map((e) => JSON.stringify(e)),
      );
      return excess;
    }
    writeAndSync(
      archivePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
      toArchive.map((env) => JSON.stringify(env) + "\n").join(""),
    );
    atomicRewriteInbox(inboxPath, toRetain);
    return excess;
  };
  if (shouldUseInMemory(inboxPath)) return rotateOp();
  const lock = options?.lockPath?.trim() || defaultLockPathFor(inboxPath);
  return withExclusiveLock(lock, "mailbox-rotator", rotateOp);
}
