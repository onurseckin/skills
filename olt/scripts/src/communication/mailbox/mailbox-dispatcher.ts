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
import { advanceMailboxCursorBatch, loadMailboxCursor } from "./cursor-tracker.ts";
import { createSignedEnvelope } from "./envelope.ts";
import { ensureMailboxDirectories, resolveMailboxPaths } from "./mailbox-paths.ts";
import { appendMailboxMessage, readUnreadMessages } from "./mailbox-stream.ts";

export interface CollectReceiptsOptions {
  readonly correlationId?: string;
  readonly messageType?: MailboxMessageType;
  readonly baseDir?: string;
  readonly cursor?: MailboxCursor | null;
  readonly advanceCursor?: boolean;
}

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

/**
 * Discovers and resolves agent IDs from a logical role name or direct agent ID.
 */
export function resolveRecipientAgentIds(roleOrId: string, baseDir?: string): readonly string[] {
  const target = requireNonEmpty(roleOrId, "recipient role or ID");
  validatePathSafety(target);

  const root = resolve(baseDir ?? process.cwd());
  const mailboxesDir = join(root, ".olt", "mailboxes");
  const locksDir = join(mailboxesDir, ".locks");
  const discoveredIds = new Set<string>();

  if (existsSync(mailboxesDir)) {
    try {
      const entries = readdirSync(mailboxesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          discoveredIds.add(entry.name);
        }
      }
    } catch (err) {
      if (err instanceof HarnessError) throw err;
      throw new HarnessError("INTEGRITY", `Failed to read mailboxes directory: ${String(err)}`);
    }
  }

  if (existsSync(locksDir)) {
    try {
      const lockEntries = readdirSync(locksDir, { withFileTypes: true });
      for (const entry of lockEntries) {
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

  if (discoveredIds.has(target)) {
    return Object.freeze([target]);
  }

  const roleMatches = Array.from(discoveredIds)
    .filter((id) => matchesRoleSubstring(id, target))
    .sort();

  if (roleMatches.length > 0) {
    return Object.freeze(roleMatches);
  }

  return Object.freeze([target]);
}

/**
 * Formats, signs, and dispatches a peer message into the recipient inbox and sender outbox.
 */
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
  if (resolved.length === 0) {
    throw new HarnessError("NOT_FOUND", `Recipient '${recipientRoleOrId}' not found`);
  }
  const recipientId = resolved[0]!;

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

/**
 * Dispatches wave notifications to multiple recipient agents.
 */
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
    const envelope = dispatchPeerMessage<T>(dispatchOptions);
    results.push(envelope);
  }

  return Object.freeze(results);
}

/**
 * Collects unread receipts from agent inbox with optional correlationId/type filtering and cursor advancement.
 */
export function collectInboxReceipts(
  agentId: string,
  options?: CollectReceiptsOptions,
): ReceiptCollectionResult {
  const validAgentId = requireNonEmpty(agentId, "agentId");
  const paths = resolveMailboxPaths(validAgentId, options?.baseDir);
  const cursor =
    options?.cursor !== undefined ? options.cursor : loadMailboxCursor(paths.cursorPath);

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

  if (options?.advanceCursor && receipts.length > 0) {
    advanceMailboxCursorBatch(paths.cursorPath, receipts, cursor, paths.lockPath);
  }

  return {
    totalReceipts: receipts.length,
    receipts: Object.freeze(receipts as readonly MailboxEnvelope[]),
  };
}
