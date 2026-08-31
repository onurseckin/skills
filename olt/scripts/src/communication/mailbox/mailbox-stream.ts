import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { withExclusiveLock } from "../locking/index.ts";
import type { MailboxCursor, MailboxEnvelope } from "../types.ts";
import { createEmptyCursor, isMessageProcessed } from "./cursor-tracker.ts";
import { verifyEnvelopeHmac } from "./envelope.ts";
import {
  defaultLockPathFor,
  ensureParentDir,
  isVirtualMailboxPath,
  registerInMemoryMailboxDir,
  type ReadUnreadMessagesOptions,
  type ReadUnreadMessagesResult,
  type RotateMailboxOptions,
} from "./mailbox-paths.ts";
import * as q from "./quarantine.ts";
import { getInMemoryQuarantine } from "./quarantine.ts";

export { defaultLockPathFor, ensureParentDir, getInMemoryQuarantine };
export type { ReadUnreadMessagesOptions, ReadUnreadMessagesResult, RotateMailboxOptions };

const serialize = (e: unknown) => JSON.stringify(e);
const inMemoryMailboxes = new Map<string, string[]>();
let inMemoryStreamModeEnabled = false;

export const setInMemoryStreamMode = (e: boolean): void => {
  inMemoryStreamModeEnabled = e;
};
export const isInMemoryStreamMode = (): boolean => inMemoryStreamModeEnabled;
export const getInMemoryMailbox = (p: string): readonly string[] | undefined =>
  inMemoryMailboxes.get(p);
export const setInMemoryMailbox = (p: string, l: readonly string[]): void => {
  inMemoryMailboxes.set(p, [...l]);
};
export const clearInMemoryMailboxStore = (): void => {
  inMemoryMailboxes.clear();
  q.clearInMemoryQuarantines();
};
export const shouldUseInMemory = (p: string): boolean =>
  inMemoryStreamModeEnabled || isVirtualMailboxPath(p) || inMemoryMailboxes.has(p);

function appendInMemoryMessage(inboxPath: string, env: MailboxEnvelope<unknown>): void {
  const slash = Math.max(inboxPath.lastIndexOf("/"), inboxPath.lastIndexOf("\\"));
  registerInMemoryMailboxDir(slash > 0 ? inboxPath.slice(0, slash) : inboxPath);
  const cur = inMemoryMailboxes.get(inboxPath) ?? [];
  inMemoryMailboxes.set(inboxPath, cur.concat(serialize(env)));
}

export function writeAndSync(filePath: string, flags: number, content: string): void {
  ensureParentDir(filePath);
  const fd = fs.openSync(filePath, flags, 0o644);
  try {
    if (content.length > 0) fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function isValidEnvelopeStructure(obj: unknown): obj is MailboxEnvelope<unknown> {
  if (!obj || typeof obj !== "object") return false;
  const r = obj as Record<string, unknown>,
    s = (k: string) => typeof r[k] === "string" && Boolean((r[k] as string).trim());
  return (
    s("id") &&
    typeof r.sequence === "number" &&
    Number.isFinite(r.sequence) &&
    typeof r.sender_role === "string" &&
    s("sender_id") &&
    s("recipient_id") &&
    s("message_type") &&
    s("timestamp") &&
    s("correlation_id") &&
    s("hmac_signature") &&
    "payload" in r
  );
}

export function atomicRewriteInbox(
  inboxPath: string,
  envelopes: readonly MailboxEnvelope<unknown>[],
): void {
  const lines = envelopes.map(serialize);
  if (shouldUseInMemory(inboxPath)) {
    inMemoryMailboxes.set(inboxPath, lines);
    return;
  }
  const tmp = `${inboxPath}.${randomUUID()}.tmp`;
  writeAndSync(
    tmp,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC,
    lines.map((s) => s + "\n").join(""),
  );
  fs.renameSync(tmp, inboxPath);
}

function writeQuarantinedLog(
  qPath: string,
  items: readonly { readonly line: string; readonly reason: string }[],
): void {
  if (items.length === 0) return;
  const formatted = items
    .map(
      (i) =>
        `[${new Date().toISOString()}] [REASON: ${i.reason}] ${q.escapeQuarantinePayload(i.line)}\n`,
    )
    .join("");
  if (shouldUseInMemory(qPath)) q.writeInMemoryQuarantine(qPath, formatted);
  else
    writeAndSync(
      qPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND,
      formatted,
    );
}

export function appendMailboxMessage(
  inboxPath: string,
  env: MailboxEnvelope<unknown>,
  lockPath?: string,
): void {
  if (!inboxPath?.trim())
    throw new HarnessError("INVALID_ARGUMENT", "inboxPath must be a non-empty string");
  if (!isValidEnvelopeStructure(env))
    throw new HarnessError("INVALID_ARGUMENT", "Invalid MailboxEnvelope structure");
  if (shouldUseInMemory(inboxPath)) {
    appendInMemoryMessage(inboxPath, env);
    return;
  }
  const lock = lockPath?.trim() || defaultLockPathFor(inboxPath);
  withExclusiveLock(lock, env.recipient_id || env.sender_id || "stream", () => {
    writeAndSync(
      inboxPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND,
      serialize(env) + "\n",
    );
  });
}

function parseMailboxLines(
  inboxPath: string,
  rawLines: readonly string[],
  opts?: ReadUnreadMessagesOptions,
) {
  const valid: MailboxEnvelope<unknown>[] = [],
    quarantined: { readonly line: string; readonly reason: string }[] = [],
    qPath = opts?.quarantinePath;
  const pushQ = (line: string, reason: string, msg: string) => {
    if (qPath) {
      quarantined.push({ line, reason });
      return true;
    }
    throw new HarnessError("INTEGRITY", msg);
  };
  for (const line of rawLines) {
    if (!line.trim()) continue;
    let p: unknown;
    try {
      p = JSON.parse(line);
    } catch {
      pushQ(line, "MALFORMED_JSON_SYNTAX", `Malformed JSON in mailbox '${inboxPath}'`);
      continue;
    }
    if (!isValidEnvelopeStructure(p)) {
      pushQ(
        line,
        "INVALID_ENVELOPE_STRUCTURE",
        `Invalid envelope structure in mailbox '${inboxPath}'`,
      );
      continue;
    }
    if (opts?.verifyHmac && !verifyEnvelopeHmac(p, opts.secretKey).valid) {
      pushQ(line, "HMAC_VERIFICATION_FAILED: invalid", "HMAC failed: invalid");
      continue;
    }
    valid.push(p as MailboxEnvelope<unknown>);
  }
  return { valid, quarantined };
}

function readRawInboxLines(inboxPath: string): readonly string[] {
  if (shouldUseInMemory(inboxPath)) return inMemoryMailboxes.get(inboxPath) ?? [];
  return fs.existsSync(inboxPath) ? fs.readFileSync(inboxPath, "utf8").split("\n") : [];
}

export function readUnreadMessages(
  inboxPath: string,
  cursor?: MailboxCursor | null,
  opts?: ReadUnreadMessagesOptions,
): ReadUnreadMessagesResult {
  if (!inboxPath?.trim())
    throw new HarnessError("INVALID_ARGUMENT", "inboxPath must be a non-empty string");
  const readOp = (): ReadUnreadMessagesResult => {
    const raw = readRawInboxLines(inboxPath);
    if (raw.length === 0) return { messages: [], quarantinedCount: 0 };
    const { valid, quarantined } = parseMailboxLines(inboxPath, raw, opts);
    if (quarantined.length > 0 && opts?.quarantinePath) {
      writeQuarantinedLog(opts.quarantinePath, quarantined);
      atomicRewriteInbox(inboxPath, valid);
    }
    const cur = cursor ?? createEmptyCursor();
    return {
      messages: valid.filter((e) => !isMessageProcessed(e, cur)),
      quarantinedCount: quarantined.length,
    };
  };
  const lock = opts?.lockPath?.trim() || defaultLockPathFor(inboxPath);
  return shouldUseInMemory(inboxPath)
    ? readOp()
    : withExclusiveLock(lock, "mailbox-reader", readOp);
}

export function quarantineTornLines(inboxPath: string, quarantinePath: string): number {
  if (!quarantinePath?.trim())
    throw new HarnessError("INVALID_ARGUMENT", "quarantinePath must be a non-empty string");
  return readUnreadMessages(inboxPath, null, { quarantinePath }).quarantinedCount;
}

export function rotateMailboxMessages(
  inboxPath: string,
  archivePath: string,
  opts?: RotateMailboxOptions,
): number {
  if (!inboxPath?.trim() || !archivePath?.trim())
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "inboxPath and archivePath must be non-empty strings",
    );
  if (resolve(inboxPath) === resolve(archivePath))
    throw new HarnessError("INVALID_ARGUMENT", "inboxPath and archivePath must be distinct paths");
  const max = opts?.maxActiveMessages ?? 1000;
  if (!Number.isInteger(max) || max <= 0)
    throw new HarnessError("INVALID_ARGUMENT", "maxActiveMessages must be a positive integer");

  const rotateOp = (): number => {
    const raw = readRawInboxLines(inboxPath);
    if (raw.length === 0) return 0;
    const envs: MailboxEnvelope<unknown>[] = [];
    for (const l of raw) {
      try {
        const p = JSON.parse(l.trim());
        if (isValidEnvelopeStructure(p)) envs.push(p);
      } catch {}
    }
    if (envs.length <= max) return 0;
    const excess = envs.length - max,
      toArch = envs.slice(0, excess),
      toRet = envs.slice(excess);
    if (shouldUseInMemory(inboxPath) || shouldUseInMemory(archivePath)) {
      const cur = inMemoryMailboxes.get(archivePath) ?? [];
      inMemoryMailboxes.set(archivePath, cur.concat(toArch.map(serialize)));
      inMemoryMailboxes.set(inboxPath, toRet.map(serialize));
      return excess;
    }
    writeAndSync(
      archivePath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND,
      toArch.map((e) => serialize(e) + "\n").join(""),
    );
    atomicRewriteInbox(inboxPath, toRet);
    return excess;
  };

  const lock = opts?.lockPath?.trim() || defaultLockPathFor(inboxPath);
  return shouldUseInMemory(inboxPath)
    ? rotateOp()
    : withExclusiveLock(lock, "mailbox-rotator", rotateOp);
}
