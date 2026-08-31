import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { MailboxEnvelope } from "../types.ts";
import { rewriteInMemoryInbox, shouldUseInMemory } from "./mailbox-stream-store.ts";

export function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function defaultLockPathFor(filePath: string): string {
  const res = resolve(filePath);
  const m = res.match(/(.*)[/\\]\.olt[/\\]mailboxes[/\\]([^/\\]+)[/\\]/);
  return m?.[1] && m?.[2]
    ? join(m[1], ".olt", "locks", "mailboxes", `${m[2]}.lock`)
    : `${filePath}.lock`;
}

export function writeAndSync(filePath: string, flags: number, content: string): void {
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

export function atomicRewriteInbox(
  inboxPath: string,
  envelopes: readonly MailboxEnvelope<unknown>[],
): void {
  if (shouldUseInMemory(inboxPath)) {
    rewriteInMemoryInbox(inboxPath, envelopes);
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
