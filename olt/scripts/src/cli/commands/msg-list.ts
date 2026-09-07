import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isProcessAlive, readHolderPid } from "../../communication/locking/index.ts";
import {
  createEmptyCursor,
  getInMemoryMailbox,
  getInMemoryQuarantine,
  inspectListenerLiveness,
  isMessageProcessed,
  isValidEnvelopeStructure,
  listMailboxAgentIds,
  loadMailboxCursor,
  resolveMailboxPaths,
  shouldUseInMemory,
  type ListenerLivenessResult,
  type ListenerLivenessStatus,
} from "../../communication/mailbox/index.ts";
import type { MailboxEnvelope, MailboxMessageType } from "../../communication/types.ts";
import { enforceLineLimit, formatTable } from "../formatters/line-limiter.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export type MessageDeliveryStatus = "DELIVERED" | "MARKED-READ" | "UNREAD" | "UNDELIVERED";

export interface MessageDeliveryState {
  readonly id: string;
  readonly sequence: number;
  readonly sender_id: string;
  readonly senderId: string;
  readonly recipient_id: string;
  readonly recipientId: string;
  readonly message_type: MailboxMessageType;
  readonly messageType: MailboxMessageType;
  readonly timestamp: string;
  readonly correlation_id: string;
  readonly correlationId: string;
  readonly status: MessageDeliveryStatus;
  readonly delivery_status: MessageDeliveryStatus;
  readonly deliveryStatus: MessageDeliveryStatus;
  readonly read_status: "MARKED-READ" | "UNREAD";
  readonly readStatus: "MARKED-READ" | "UNREAD";
  readonly delivered: boolean;
  readonly read: boolean;
  readonly seen: boolean;
  readonly marked_read: boolean;
  readonly markedRead: boolean;
  readonly unread: boolean;
  readonly direction: "inbox" | "outbox";
  readonly [key: string]: unknown;
}

export interface MailboxSummary {
  readonly agentId: string;
  readonly inboxCount: number;
  readonly outboxCount: number;
  readonly unreadCount: number;
  readonly quarantineCount: number;
  readonly lastReadSequence: number;
  readonly lastReadId: string;
  readonly unreadDepth: number;
  readonly deliveredCount: number;
  readonly markedReadCount: number;
  readonly listenerActive: boolean;
  readonly listenerPid: number | null;
  readonly listenerStatus: ListenerLivenessStatus;
  readonly listenerLiveness?: ListenerLivenessResult;
  readonly messages: readonly MessageDeliveryState[];
  readonly inboxMessages: readonly MessageDeliveryState[];
  readonly outboxMessages: readonly MessageDeliveryState[];
  readonly unreadIds: readonly string[];
  readonly seenIds: readonly string[];
  readonly [key: string]: unknown;
}

export interface MsgListResult {
  readonly markdown: string;
  readonly mailboxes: readonly MailboxSummary[];
  readonly totalMailboxes: number;
  readonly unreadDepth: number;
  readonly messages: readonly MessageDeliveryState[];
  readonly messagesById: Readonly<Record<string, MessageDeliveryState>>;
  readonly [key: string]: unknown;
}

function countLines(filePath: string): number {
  if (shouldUseInMemory(filePath)) {
    return (getInMemoryMailbox(filePath) ?? []).length;
  }
  if (!existsSync(filePath)) {
    return 0;
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return content.split("\n").filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

function countQuarantineLines(filePath: string): number {
  if (shouldUseInMemory(filePath)) {
    const lines = getInMemoryQuarantine(filePath) ?? [];
    return lines.filter((line) => line.trim().length > 0).length;
  }
  if (!existsSync(filePath)) {
    return 0;
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return content.split("\n").filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

function readEnvelopesFromFile(filePath: string): readonly MailboxEnvelope<unknown>[] {
  let rawLines: readonly string[] = [];
  if (shouldUseInMemory(filePath)) {
    rawLines = getInMemoryMailbox(filePath) ?? [];
  } else if (existsSync(filePath)) {
    try {
      rawLines = readFileSync(filePath, "utf8").split("\n");
    } catch {
      return [];
    }
  }
  const envelopes: MailboxEnvelope<unknown>[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isValidEnvelopeStructure(parsed)) {
        envelopes.push(parsed);
      }
    } catch {}
  }
  return envelopes;
}

function toDeliveryState(
  env: MailboxEnvelope<unknown>,
  status: MessageDeliveryStatus,
  deliveryStatus: MessageDeliveryStatus,
  isRead: boolean,
  isDelivered: boolean,
  direction: "inbox" | "outbox",
): MessageDeliveryState {
  return {
    id: env.id,
    sequence: env.sequence,
    sender_id: env.sender_id,
    senderId: env.sender_id,
    recipient_id: env.recipient_id,
    recipientId: env.recipient_id,
    message_type: env.message_type,
    messageType: env.message_type,
    timestamp: env.timestamp,
    correlation_id: env.correlation_id,
    correlationId: env.correlation_id,
    status,
    delivery_status: deliveryStatus,
    deliveryStatus,
    read_status: isRead ? "MARKED-READ" : "UNREAD",
    readStatus: isRead ? "MARKED-READ" : "UNREAD",
    delivered: isDelivered,
    read: isRead,
    seen: isRead,
    marked_read: isRead,
    markedRead: isRead,
    unread: isDelivered && !isRead,
    direction,
  };
}

function summarizeMailbox(agentId: string, effectiveBase: string): MailboxSummary {
  const paths = resolveMailboxPaths(agentId, effectiveBase);
  const inboxEnvelopes = readEnvelopesFromFile(paths.inboxPath);
  const outboxEnvelopes = readEnvelopesFromFile(paths.outboxPath);
  const cursor =
    existsSync(paths.cursorPath) || shouldUseInMemory(paths.cursorPath)
      ? loadMailboxCursor(paths.cursorPath)
      : createEmptyCursor();

  const outboxCount = countLines(paths.outboxPath);
  const quarantineCount = countQuarantineLines(paths.quarantinePath);
  const drainLockPath = paths.lockPath.endsWith(".lock")
    ? `${paths.lockPath.slice(0, -5)}.drain.lock`
    : `${paths.lockPath}.drain.lock`;
  const drainPid = readHolderPid(drainLockPath);
  const drainAlive = drainPid !== null && isProcessAlive(drainPid);
  const liveness = inspectListenerLiveness(agentId, { baseDir: effectiveBase });
  const listenerActive =
    (liveness.heartbeat !== null && !liveness.isStopped && liveness.isProcessAlive) ||
    (drainAlive && (liveness.heartbeat === null || !liveness.isStopped));
  const listenerPid = liveness.pid ?? (drainAlive ? drainPid : null);
  const listenerStatus: ListenerLivenessStatus =
    liveness.heartbeat !== null ? liveness.status : drainAlive ? "no_messages" : liveness.status;

  const seenIdsSet = new Set(cursor.seen_ids);

  const inboxMessages: MessageDeliveryState[] = inboxEnvelopes.map((env) => {
    const isRead = isMessageProcessed(env, cursor) || seenIdsSet.has(env.id);
    const status: MessageDeliveryStatus = isRead ? "MARKED-READ" : "UNREAD";
    const deliveryStatus: MessageDeliveryStatus = isRead ? "MARKED-READ" : "DELIVERED";
    return toDeliveryState(env, status, deliveryStatus, isRead, true, "inbox");
  });

  const outboxMessages: MessageDeliveryState[] = outboxEnvelopes.map((outEnv) => {
    let isDelivered = false;
    let recipientSaw = false;
    try {
      const recipientPaths = resolveMailboxPaths(outEnv.recipient_id, effectiveBase);
      const recipientInbox = readEnvelopesFromFile(recipientPaths.inboxPath);
      isDelivered = recipientInbox.some((e) => e.id === outEnv.id);
      if (isDelivered) {
        const recipientCursor =
          existsSync(recipientPaths.cursorPath) || shouldUseInMemory(recipientPaths.cursorPath)
            ? loadMailboxCursor(recipientPaths.cursorPath)
            : createEmptyCursor();
        recipientSaw =
          isMessageProcessed(outEnv, recipientCursor) ||
          recipientCursor.seen_ids.includes(outEnv.id);
      }
    } catch {}

    const outStatus: MessageDeliveryStatus = !isDelivered
      ? "UNDELIVERED"
      : recipientSaw
        ? "MARKED-READ"
        : "DELIVERED";

    return toDeliveryState(outEnv, outStatus, outStatus, recipientSaw, isDelivered, "outbox");
  });

  const unreadMessages = inboxMessages.filter((m) => m.unread);
  const unreadCount = unreadMessages.length;
  const unreadDepth = unreadCount;
  const markedReadCount = inboxMessages.filter((m) => m.read).length;
  const deliveredCount = inboxMessages.length;
  const unreadIds = unreadMessages.map((m) => m.id);
  const seenIds = inboxMessages.filter((m) => m.seen).map((m) => m.id);
  const allMessages = [...inboxMessages, ...outboxMessages];

  return {
    agentId,
    inboxCount: inboxEnvelopes.length,
    outboxCount,
    unreadCount,
    quarantineCount,
    lastReadSequence: cursor.last_read_sequence,
    lastReadId: cursor.last_read_id,
    unreadDepth,
    deliveredCount,
    markedReadCount,
    listenerActive,
    listenerPid,
    listenerStatus,
    listenerLiveness: liveness,
    messages: allMessages,
    inboxMessages,
    outboxMessages,
    unreadIds,
    seenIds,
  };
}

export function msgListCommand(flags: Flags, _context?: CommandContext): MsgListResult {
  const baseDir = textFlag(flags, "base-dir", false);
  const actor = textFlag(flags, "actor", false);
  const messageId = textFlag(flags, "message-id", false) ?? textFlag(flags, "id", false);
  const detailed = boolFlag(flags, "detailed") || boolFlag(flags, "verbose");
  const effectiveBase = baseDir !== undefined ? resolve(baseDir) : process.cwd();
  const isOlt =
    effectiveBase.replace(/\\/g, "/").endsWith("/.olt") || effectiveBase.endsWith(".olt");
  const mailboxesRoot = isOlt
    ? join(effectiveBase, "mailboxes")
    : join(effectiveBase, ".olt", "mailboxes");

  let agentIds: string[] = [];
  if (actor !== undefined) {
    const actorPaths = resolveMailboxPaths(actor, effectiveBase);
    if (existsSync(actorPaths.agentMailboxDir) || shouldUseInMemory(actorPaths.inboxPath)) {
      agentIds = [actor];
    }
  } else {
    const discovered = new Set<string>();
    if (existsSync(mailboxesRoot)) {
      try {
        const entries = readdirSync(mailboxesRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            discovered.add(entry.name);
          }
        }
      } catch {}
    }
    const inMemoryIds = listMailboxAgentIds(effectiveBase);
    for (const id of inMemoryIds) {
      discovered.add(id);
    }
    agentIds = Array.from(discovered).sort();
  }

  const summaries: MailboxSummary[] = agentIds.map((id) => summarizeMailbox(id, effectiveBase));
  const totalUnreadDepth = summaries.reduce((acc, m) => acc + m.unreadDepth, 0);

  const messagesById: Record<string, MessageDeliveryState> = {};
  const allMessages: MessageDeliveryState[] = [];
  for (const summary of summaries) {
    for (const msg of summary.messages) {
      allMessages.push(msg);
      const existing = messagesById[msg.id];
      if (!existing || (!existing.seen && msg.seen) || existing.direction === "outbox") {
        messagesById[msg.id] = msg;
      }
    }
  }

  const lines: string[] = [
    "### Mailbox Summaries (`msg:list`)",
    `- **Total Mailboxes**: \`${summaries.length}\``,
    `- **Total Unread Depth**: \`${totalUnreadDepth}\``,
    "",
  ];

  if (summaries.length > 0) {
    lines.push(
      ...formatTable(
        ["Agent", "Listener", "Inbox", "Unread", "Outbox", "Quarantine", "Last Seq"],
        summaries.map((m) => [
          `\`${m.agentId}\``,
          m.listenerStatus,
          String(m.inboxCount),
          String(m.unreadCount),
          String(m.outboxCount),
          String(m.quarantineCount),
          String(m.lastReadSequence),
        ]),
      ),
    );
  } else {
    lines.push("_No mailboxes found._");
  }

  if (messageId !== undefined) {
    const target = messagesById[messageId];
    lines.push("");
    lines.push(`### Message Delivery Status (\`${messageId}\`)`);
    if (target) {
      lines.push(`- **Status**: \`${target.status}\``);
      lines.push(`- **Delivered**: \`${target.delivered}\``);
      lines.push(`- **Seen/Read**: \`${target.seen}\``);
      lines.push(`- **Sender**: \`${target.sender_id}\``);
      lines.push(`- **Recipient**: \`${target.recipient_id}\``);
    } else {
      lines.push("- **Status**: `NOT_FOUND`");
    }
  }

  if (detailed && allMessages.length > 0) {
    lines.push("");
    lines.push("### Per-Message Delivery Status");
    const preview = allMessages.slice(0, 10);
    for (const m of preview) {
      const shortId = m.id.length > 8 ? `${m.id.slice(0, 8)}...` : m.id;
      lines.push(`- \`${shortId}\` [${m.direction}] to \`${m.recipient_id}\`: \`${m.status}\``);
    }
    if (allMessages.length > 10) {
      lines.push(`- ... and ${allMessages.length - 10} more`);
    }
  }

  return {
    markdown: enforceLineLimit(lines.join("\n"), 25),
    mailboxes: summaries,
    totalMailboxes: summaries.length,
    unreadDepth: totalUnreadDepth,
    messages: allMessages,
    messagesById,
  };
}
