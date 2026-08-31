import { constants, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { withExclusiveLock } from "../locking/index.ts";
import type { MailboxEnvelope } from "../types.ts";
import {
  atomicRewriteInbox,
  defaultLockPathFor,
  isValidEnvelopeStructure,
  writeAndSync,
} from "./mailbox-stream-io.ts";
import {
  getInMemoryMailbox,
  rotateInMemoryMailbox,
  shouldUseInMemory,
} from "./mailbox-stream-store.ts";

export interface RotateMailboxOptions {
  readonly maxActiveMessages?: number;
  readonly lockPath?: string;
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
      if (!getInMemoryMailbox(inboxPath)) return 0;
      rawLines = getInMemoryMailbox(inboxPath) ?? [];
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
      rotateInMemoryMailbox(inboxPath, archivePath, toArchive, toRetain);
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
