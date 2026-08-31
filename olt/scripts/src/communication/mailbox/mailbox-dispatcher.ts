import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type {
  BroadcastNotificationOptions,
  CreateEnvelopeOptions,
  DispatchMessageOptions,
  MailboxCursor,
  MailboxEnvelope,
  MailboxMessageType,
  ReceiptCollectionResult,
} from "../types.ts";
import {
  advanceMailboxCursorBatch,
  createEmptyCursor,
  loadMailboxCursor,
} from "./cursor-tracker.ts";
import { createSignedEnvelope } from "./envelope.ts";
import {
  ensureMailboxDirectories,
  getInMemoryMailboxDirs,
  isVirtualMailboxPath,
  resolveMailboxPaths,
} from "./mailbox-paths.ts";
import {
  appendMailboxMessage,
  isInMemoryStreamMode,
  readUnreadMessages,
} from "./mailbox-stream.ts";

export interface CollectReceiptsOptions {
  readonly correlationId?: string;
  readonly messageType?: MailboxMessageType;
  readonly baseDir?: string;
  readonly cursor?: MailboxCursor | null;
  readonly advanceCursor?: boolean;
}

const inMemoryCursors = new Map<string, MailboxCursor>();

export const getInMemoryCursor = (cursorPath: string): MailboxCursor | undefined =>
  inMemoryCursors.get(cursorPath);
export const setInMemoryCursor = (cursorPath: string, cursor: MailboxCursor): void => {
  inMemoryCursors.set(cursorPath, cursor);
};
export const clearInMemoryCursors = (): void => {
  inMemoryCursors.clear();
};

function requireNonEmpty(val: unknown, name: string): string {
  if (typeof val !== "string" || val.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", `${name} must be a non-empty string`);
  }
  return val.trim();
}

function validatePathSafety(target: string): void {
  if (
    target === "." ||
    target.includes("..") ||
    target.includes("/") ||
    target.includes("\\") ||
    target.includes("\0")
  ) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Invalid recipient role or ID '${target}': cannot contain path separators or traversal elements`,
    );
  }
}

function matchesRoleSubstring(agentId: string, role: string): boolean {
  const idLower = agentId.toLowerCase();
  const roleLower = role.toLowerCase();
  return (
    idLower === roleLower ||
    idLower.startsWith(`${roleLower}-`) ||
    idLower.startsWith(`${roleLower}_`) ||
    idLower.includes(roleLower)
  );
}

export function resolveRecipientAgentIds(roleOrId: string, baseDir?: string): readonly string[] {
  const target = requireNonEmpty(roleOrId, "recipient role or ID");
  validatePathSafety(target);

  const discoveredIds = new Set<string>();

  for (const dir of getInMemoryMailboxDirs()) {
    const m = dir.match(
      new RegExp("[/\\\\].olt[/\\\\](?:mailboxes|locks[/\\\\]mailboxes)[/\\\\]([^/\\\\]+)$"),
    );
    if (m && m[1] && !m[1].startsWith(".")) {
      const id = m[1].endsWith(".lock") ? m[1].slice(0, -5) : m[1];
      if (id.length > 0) discoveredIds.add(id);
    }
  }

  const effectiveBase = baseDir !== undefined ? baseDir : process.cwd();
  if (!effectiveBase.startsWith("virtual:") && !effectiveBase.startsWith("mem:")) {
    const root = resolve(effectiveBase);
    const mailboxesDir = join(root, ".olt", "mailboxes");
    const mailboxLocksDir = join(root, ".olt", "locks", "mailboxes");
    const generalLocksDir = join(root, ".olt", "locks");
    const legacyLocksDir = join(mailboxesDir, ".locks");

    if (existsSync(mailboxesDir)) {
      try {
        for (const entry of readdirSync(mailboxesDir, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) discoveredIds.add(entry.name);
        }
      } catch (err) {
        if (err instanceof HarnessError) throw err;
        throw new HarnessError("INTEGRITY", `Failed to read mailboxes directory: ${String(err)}`);
      }
    }

    for (const lockDir of [mailboxLocksDir, generalLocksDir, legacyLocksDir]) {
      if (existsSync(lockDir)) {
        try {
          for (const entry of readdirSync(lockDir, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith(".lock") && !entry.name.startsWith(".")) {
              const id = entry.name.slice(0, -5);
              if (id.length > 0) discoveredIds.add(id);
            }
          }
        } catch (err) {
          if (err instanceof HarnessError) throw err;
          throw new HarnessError("INTEGRITY", `Failed to read lock directory: ${String(err)}`);
        }
      }
    }
  }

  if (discoveredIds.has(target)) return Object.freeze([target]);

  const roleMatches = Array.from(discoveredIds)
    .filter((id) => matchesRoleSubstring(id, target))
    .sort();

  if (roleMatches.length > 0) return Object.freeze(roleMatches);
  return Object.freeze([target]);
}

export function dispatchPeerMessage<T = Record<string, unknown>>(
  options: DispatchMessageOptions<T>,
): MailboxEnvelope<T> {
  if (!options || typeof options !== "object") {
    throw new HarnessError("INVALID_ARGUMENT", "options must be an object");
  }
  const senderId = requireNonEmpty(options.senderId, "senderId");
  const senderRole = requireNonEmpty(options.senderRole, "senderRole");
  const recipientRoleOrId = requireNonEmpty(options.recipientRoleOrId, "recipientRoleOrId");
  const messageType = requireNonEmpty(options.messageType, "messageType") as MailboxMessageType;

  const resolved = resolveRecipientAgentIds(recipientRoleOrId, options.baseDir);
  if (resolved.length === 0 || resolved[0] === undefined) {
    throw new HarnessError("NOT_FOUND", `Recipient '${recipientRoleOrId}' not found`);
  }
  const recipientId = resolved[0];

  const envelopeOptions: CreateEnvelopeOptions<T> = {
    senderId,
    senderRole,
    recipientId,
    messageType,
    payload: options.payload,
    ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
    ...(options.secretKey !== undefined ? { secretKey: options.secretKey } : {}),
  };

  const envelope = createSignedEnvelope<T>(envelopeOptions);
  const recipientPaths = resolveMailboxPaths(recipientId, options.baseDir);
  ensureMailboxDirectories(recipientPaths);
  appendMailboxMessage(
    recipientPaths.inboxPath,
    envelope as MailboxEnvelope<unknown>,
    recipientPaths.lockPath,
  );

  const senderPaths = resolveMailboxPaths(senderId, options.baseDir);
  ensureMailboxDirectories(senderPaths);
  appendMailboxMessage(
    senderPaths.outboxPath,
    envelope as MailboxEnvelope<unknown>,
    senderPaths.lockPath,
  );

  return envelope;
}

export function broadcastWaveNotification<T = Record<string, unknown>>(
  options: BroadcastNotificationOptions<T>,
): readonly MailboxEnvelope<T>[] {
  if (!options || typeof options !== "object") {
    throw new HarnessError("INVALID_ARGUMENT", "options must be an object");
  }
  const senderId = requireNonEmpty(options.senderId, "senderId");
  const senderRole = requireNonEmpty(options.senderRole, "senderRole");
  const messageType = requireNonEmpty(options.messageType, "messageType") as MailboxMessageType;
  if (!Array.isArray(options.recipientIds)) {
    throw new HarnessError("INVALID_ARGUMENT", "recipientIds must be an array");
  }

  const targetIds: string[] = [];
  for (const entry of options.recipientIds) {
    const resolved = resolveRecipientAgentIds(entry, options.baseDir);
    for (const id of resolved) {
      if (!targetIds.includes(id)) targetIds.push(id);
    }
  }

  const results: MailboxEnvelope<T>[] = [];
  for (const targetId of targetIds) {
    const dispatchOptions: DispatchMessageOptions<T> = {
      senderId,
      senderRole,
      recipientRoleOrId: targetId,
      messageType,
      payload: options.payload,
      ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
      ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
      ...(options.secretKey !== undefined ? { secretKey: options.secretKey } : {}),
    };
    results.push(dispatchPeerMessage<T>(dispatchOptions));
  }

  return Object.freeze(results);
}

export function collectInboxReceipts(
  agentId: string,
  options?: CollectReceiptsOptions,
): ReceiptCollectionResult {
  const validAgentId = requireNonEmpty(agentId, "agentId");
  const paths = resolveMailboxPaths(validAgentId, options?.baseDir);
  let cursor: MailboxCursor | null = null;
  if (options?.cursor !== undefined) {
    cursor = options.cursor;
  } else if (inMemoryCursors.has(paths.cursorPath)) {
    cursor = inMemoryCursors.get(paths.cursorPath) ?? null;
  } else if (isVirtualMailboxPath(paths.cursorPath) || isInMemoryStreamMode()) {
    cursor = createEmptyCursor();
  } else {
    cursor = loadMailboxCursor(paths.cursorPath);
  }

  const { messages } = readUnreadMessages(paths.inboxPath, cursor, {
    lockPath: paths.lockPath,
    quarantinePath: paths.quarantinePath,
    verifyHmac: true,
  });

  let receipts = messages;
  if (options?.correlationId !== undefined) {
    const corrId = options.correlationId;
    receipts = receipts.filter((msg) => msg.correlation_id === corrId);
  }
  if (options?.messageType !== undefined) {
    const msgType = options.messageType;
    receipts = receipts.filter((msg) => msg.message_type === msgType);
  }

  if (options?.advanceCursor === true && receipts.length > 0) {
    if (
      isVirtualMailboxPath(paths.cursorPath) ||
      isInMemoryStreamMode() ||
      inMemoryCursors.has(paths.cursorPath)
    ) {
      const base = cursor ?? createEmptyCursor();
      let maxSeq = base.last_read_sequence;
      const seen = new Set(base.seen_ids);
      for (const r of receipts) {
        if (r.sequence > maxSeq) maxSeq = r.sequence;
        seen.add(r.id);
      }
      const lastReceipt = receipts[receipts.length - 1];
      const lastId = lastReceipt ? lastReceipt.id : base.last_read_id;
      const updated: MailboxCursor = {
        last_read_sequence: maxSeq,
        last_read_id: lastId,
        seen_ids: Array.from(seen),
        updated_at: new Date().toISOString(),
      };
      inMemoryCursors.set(paths.cursorPath, updated);
    } else {
      advanceMailboxCursorBatch(paths.cursorPath, receipts, cursor, paths.lockPath);
    }
  }

  return {
    totalReceipts: receipts.length,
    receipts: Object.freeze(receipts as readonly MailboxEnvelope[]),
  };
}
