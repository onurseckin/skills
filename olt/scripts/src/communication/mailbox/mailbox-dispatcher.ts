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
  DEFAULT_MAX_SEEN_IDS,
  advanceMailboxCursorBatch,
  clearInMemoryCursors,
  createEmptyCursor,
  getInMemoryCursor,
  loadMailboxCursor,
  saveMailboxCursor,
  setInMemoryCursor,
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
  shouldUseInMemory,
} from "./mailbox-stream.ts";
import { withExclusiveLock } from "../locking/index.ts";

export { clearInMemoryCursors, getInMemoryCursor, setInMemoryCursor };

export interface CollectReceiptsOptions {
  readonly correlationId?: string;
  readonly messageType?: MailboxMessageType;
  readonly baseDir?: string;
  readonly cursor?: MailboxCursor | null;
  readonly advanceCursor?: boolean;
}

function reqStr(val: unknown, name: string): string {
  if (typeof val !== "string" || !val.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", `${name} must be a non-empty string`);
  }
  return val.trim();
}

function checkPathSafety(target: string): void {
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

export function resolveRecipientAgentIds(
  recipientRoleOrId: string,
  baseDir?: string,
): readonly string[] {
  const target = reqStr(recipientRoleOrId, "recipientRoleOrId");
  checkPathSafety(target);
  if (baseDir && isVirtualMailboxPath(baseDir)) {
    const normBase = baseDir.replace(/\/+$/, "");
    const matching = new Set<string>();
    for (const dir of getInMemoryMailboxDirs()) {
      if (!dir.startsWith(normBase)) continue;
      const mboxMatch = dir.match(/\.olt\/mailboxes\/([^/]+)$/);
      if (mboxMatch?.[1]) {
        const id = mboxMatch[1];
        if (target === "*" || id === target || id.includes(target)) matching.add(id);
      }
      const lockMatch = dir.match(/\.olt\/locks\/mailboxes\/([^/]+)\.lock$/);
      if (lockMatch?.[1]) {
        const id = lockMatch[1];
        if (target === "*" || id === target || id.includes(target)) matching.add(id);
      }
    }
    if (matching.size > 0) return Array.from(matching).sort();
    return [target];
  }

  const root = baseDir
    ? baseDir.includes(".olt")
      ? resolve(baseDir)
      : join(resolve(baseDir), ".olt")
    : join(resolve(process.cwd()), ".olt");
  const mailboxesDir = root.endsWith("mailboxes") ? root : join(root, "mailboxes");
  if (target === "*") {
    if (!existsSync(mailboxesDir)) return [];
    try {
      return readdirSync(mailboxesDir)
        .filter((e) => !e.startsWith("."))
        .sort();
    } catch {
      return [];
    }
  }

  if (existsSync(mailboxesDir)) {
    try {
      const found = readdirSync(mailboxesDir).filter(
        (e) => !e.startsWith(".") && (e === target || e.includes(target)),
      );
      if (found.length > 0) return found.sort();
    } catch {}
  }
  return [target];
}

export function dispatchPeerMessage<T = Record<string, unknown>>(
  opts: DispatchMessageOptions<T>,
): MailboxEnvelope<T> {
  if (!opts || typeof opts !== "object") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "opts must be a valid DispatchMessageOptions object",
    );
  }
  const senderId = reqStr(opts.senderId, "senderId");
  const senderRole = reqStr(opts.senderRole, "senderRole");
  const recipientRoleOrId = reqStr(opts.recipientRoleOrId, "recipientRoleOrId");
  checkPathSafety(senderId);
  checkPathSafety(recipientRoleOrId);

  const targets = resolveRecipientAgentIds(recipientRoleOrId, opts.baseDir);
  if (targets.length === 0) {
    throw new HarnessError("INVALID_STATE", `No recipients found for '${recipientRoleOrId}'`);
  }

  const primaryRecipient = targets[0]!;
  const senderPaths = resolveMailboxPaths(senderId, opts.baseDir);
  ensureMailboxDirectories(senderPaths);

  const envelope = createSignedEnvelope<T>({
    senderId,
    senderRole,
    recipientId: primaryRecipient,
    messageType: opts.messageType,
    payload: opts.payload,
    ...(opts.sequence !== undefined ? { sequence: opts.sequence } : {}),
    ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
    ...(opts.secretKey !== undefined ? { secretKey: opts.secretKey } : {}),
  });

  for (const targetId of targets) {
    const targetPaths = resolveMailboxPaths(targetId, opts.baseDir);
    ensureMailboxDirectories(targetPaths);
    const targetEnvelope =
      targetId === primaryRecipient
        ? envelope
        : createSignedEnvelope<T>({
            senderId,
            senderRole,
            recipientId: targetId,
            messageType: opts.messageType,
            payload: opts.payload,
            ...(opts.sequence !== undefined ? { sequence: opts.sequence } : {}),
            ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
            ...(opts.secretKey !== undefined ? { secretKey: opts.secretKey } : {}),
          });
    appendMailboxMessage(targetPaths.inboxPath, targetEnvelope, targetPaths.lockPath);
  }

  appendMailboxMessage(senderPaths.outboxPath, envelope, senderPaths.lockPath);
  return envelope;
}

export function broadcastWaveNotification<T = Record<string, unknown>>(
  opts: BroadcastNotificationOptions<T>,
): readonly MailboxEnvelope<T>[] {
  if (!opts || typeof opts !== "object") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "opts must be a valid BroadcastNotificationOptions object",
    );
  }
  const senderId = reqStr(opts.senderId, "senderId");
  const senderRole = reqStr(opts.senderRole, "senderRole");
  checkPathSafety(senderId);
  if (!Array.isArray(opts.recipientIds)) {
    throw new HarnessError("INVALID_ARGUMENT", "recipientIds must be an array");
  }
  if (opts.recipientIds.length === 0) return [];
  for (const id of opts.recipientIds) {
    reqStr(id, "recipientId");
    checkPathSafety(id);
  }

  const uniqueTargets = new Set<string>();
  for (const r of opts.recipientIds) {
    for (const t of resolveRecipientAgentIds(r, opts.baseDir)) uniqueTargets.add(t);
  }

  return Array.from(uniqueTargets)
    .sort()
    .map((targetId) =>
      dispatchPeerMessage<T>({
        senderId,
        senderRole,
        recipientRoleOrId: targetId,
        messageType: opts.messageType,
        payload: opts.payload,
        ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
        ...(opts.baseDir !== undefined ? { baseDir: opts.baseDir } : {}),
        ...(opts.secretKey !== undefined ? { secretKey: opts.secretKey } : {}),
      }),
    );
}

export function collectInboxReceipts(
  agentId: string,
  opts?: CollectReceiptsOptions,
): ReceiptCollectionResult {
  const validId = reqStr(agentId, "agentId");
  const p = resolveMailboxPaths(validId, opts?.baseDir);

  const executeCollect = (): ReceiptCollectionResult => {
    const cur = opts?.cursor ?? loadMailboxCursor(p.cursorPath);
    const { messages } = readUnreadMessages(p.inboxPath, cur, {
      lockPath: `${p.lockPath}.read`,
      quarantinePath: p.quarantinePath,
      verifyHmac: true,
    });

    let receipts = messages;
    if (opts?.correlationId !== undefined) {
      receipts = receipts.filter((m) => m.correlation_id === opts.correlationId);
    }
    if (opts?.messageType !== undefined) {
      receipts = receipts.filter((m) => m.message_type === opts.messageType);
    }

    if (opts?.advanceCursor === true && receipts.length > 0) {
      const deliveredIds = new Set(receipts.map((r) => r.id));
      const seenSet = new Set(cur.seen_ids);
      for (const id of deliveredIds) {
        seenSet.add(id);
      }
      let safeSeq = cur.last_read_sequence;
      for (const msg of messages) {
        if (deliveredIds.has(msg.id) || seenSet.has(msg.id)) {
          if (msg.sequence > safeSeq) {
            safeSeq = msg.sequence;
          }
        } else {
          break;
        }
      }
      const mergedSeen = Array.from(seenSet);
      const boundedSeen =
        mergedSeen.length > DEFAULT_MAX_SEEN_IDS
          ? mergedSeen.slice(-DEFAULT_MAX_SEEN_IDS)
          : mergedSeen;
      const lastId = receipts[receipts.length - 1]!.id;
      const updatedCursor: MailboxCursor = {
        last_read_sequence: safeSeq,
        last_read_id: lastId,
        seen_ids: boundedSeen,
        updated_at: new Date().toISOString(),
      };
      saveMailboxCursor(p.cursorPath, updatedCursor);
    }

    return {
      totalReceipts: receipts.length,
      receipts: Object.freeze(receipts as readonly MailboxEnvelope[]),
    };
  };

  if (shouldUseInMemory(p.inboxPath)) {
    return executeCollect();
  }
  return withExclusiveLock(p.lockPath, "mailbox-dispatcher", executeCollect);
}
