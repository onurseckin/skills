import { identifyExecutionContext } from "../../authority/thread/index.ts";
import {
  acquireMailboxLock,
  isInMemoryLocking,
  releaseInMemoryLock,
  releaseMailboxLock,
  tryAcquireInMemoryLock,
} from "../../communication/locking/index.ts";
import {
  advanceMailboxCursorBatch,
  collectInboxReceipts,
  ensureMailboxDirectories,
  isListenerAlive,
  isVirtualMailboxPath,
  resolveMailboxPaths,
  verifyEnvelopeHmac,
} from "../../communication/mailbox/index.ts";
import type { MailboxEnvelope, MailboxMessageType } from "../../communication/types.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface ReceiptMetadata {
  readonly delivery_status: "DELIVERED" | "MARKED-READ" | "UNREAD";
  readonly deliveryStatus: "DELIVERED" | "MARKED-READ" | "UNREAD";
  readonly status: "DELIVERED" | "MARKED-READ" | "UNREAD";
  readonly delivered: boolean;
  readonly read: boolean;
  readonly seen: boolean;
  readonly cursor_advanced: boolean;
  readonly cursorAdvanced: boolean;
  readonly received_at: string;
  readonly receivedAt: string;
  readonly verified: boolean;
  readonly recipient: string;
  readonly listener_active?: boolean;
  readonly listenerActive?: boolean;
  readonly coordinated?: boolean;
  readonly [key: string]: unknown;
}

export interface EnrichedReceipt extends MailboxEnvelope {
  readonly delivery_status: "DELIVERED" | "MARKED-READ" | "UNREAD";
  readonly deliveryStatus: "DELIVERED" | "MARKED-READ" | "UNREAD";
  readonly status: "DELIVERED" | "MARKED-READ" | "UNREAD";
  readonly delivered: boolean;
  readonly read: boolean;
  readonly seen: boolean;
  readonly cursor_advanced: boolean;
  readonly cursorAdvanced: boolean;
  readonly received_at: string;
  readonly receivedAt: string;
  readonly metadata: ReceiptMetadata;
  readonly listener_active?: boolean;
  readonly listenerActive?: boolean;
  readonly coordinated?: boolean;
  readonly [key: string]: unknown;
}

export interface MsgRecvResult {
  readonly markdown: string;
  readonly actor: string;
  readonly totalReceipts: number;
  readonly receipts: readonly EnrichedReceipt[];
  readonly advanceCursor?: boolean;
  readonly listenerActive?: boolean;
  readonly coordinated?: boolean;
  readonly metadata?: {
    readonly actor: string;
    readonly totalReceipts: number;
    readonly advanceCursor: boolean;
    readonly receivedAt: string;
    readonly deliveryStatus: "DELIVERED" | "MARKED-READ" | "UNREAD";
    readonly listenerActive?: boolean;
    readonly coordinated?: boolean;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

interface DrainLockHandle {
  readonly acquired: boolean;
  readonly holderPid: number | null;
  readonly release: () => void;
}

function resolveListenerLockPath(actor: string, baseDir?: string): string {
  const paths = resolveMailboxPaths(actor, baseDir);
  return paths.lockPath.endsWith(".lock")
    ? `${paths.lockPath.slice(0, -5)}.drain.lock`
    : `${paths.lockPath}.drain.lock`;
}

function acquireDrainLock(lockPath: string, holderId: string): DrainLockHandle {
  if (isVirtualMailboxPath(lockPath) || isInMemoryLocking()) {
    const res = tryAcquireInMemoryLock(lockPath, holderId);
    if (!res.acquired || res.fd === null) {
      return { acquired: false, holderPid: res.holderPid, release: () => {} };
    }
    const fd = res.fd;
    return {
      acquired: true,
      holderPid: res.holderPid,
      release: () => releaseInMemoryLock(lockPath, fd),
    };
  }
  const res = acquireMailboxLock(lockPath, holderId, { timeoutMs: 0 });
  if (!res.acquired) {
    return { acquired: false, holderPid: res.holderPid, release: () => {} };
  }
  return {
    acquired: true,
    holderPid: res.holderPid,
    release: () => releaseMailboxLock(res),
  };
}

function isListenerActive(actor: string, baseDir?: string): boolean {
  if (isListenerAlive(actor, baseDir !== undefined ? { baseDir } : undefined)) return true;
  const drainLockPath = resolveListenerLockPath(actor, baseDir);
  const probe = acquireDrainLock(drainLockPath, `probe-${process.pid}`);
  if (!probe.acquired) return true;
  probe.release();
  return false;
}

interface CoordinatedReadResult {
  readonly receipts: readonly MailboxEnvelope[];
  readonly totalReceipts: number;
  readonly advanceCursor: boolean;
  readonly listenerActive: boolean;
}

function executeCoordinatedRead(
  recipientActor: string,
  options: {
    readonly correlationId?: string;
    readonly messageType?: MailboxMessageType;
    readonly baseDir?: string;
    readonly requestedAdvanceCursor: boolean;
  },
): CoordinatedReadResult {
  const paths = resolveMailboxPaths(recipientActor, options.baseDir);
  ensureMailboxDirectories(paths);

  const activeListener = isListenerActive(recipientActor, options.baseDir);
  let drainLock: DrainLockHandle | null = null;
  let canAdvance = false;

  if (options.requestedAdvanceCursor && !activeListener) {
    const drainLockPath = resolveListenerLockPath(recipientActor, options.baseDir);
    drainLock = acquireDrainLock(drainLockPath, `reader-${recipientActor}-${process.pid}`);
    if (drainLock.acquired) {
      canAdvance = true;
    } else {
      drainLock = null;
    }
  }

  try {
    const collection = collectInboxReceipts(recipientActor, {
      ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
      ...(options.messageType !== undefined ? { messageType: options.messageType } : {}),
      ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
      advanceCursor: false,
    });

    if (canAdvance && collection.receipts.length > 0) {
      advanceMailboxCursorBatch(paths.cursorPath, collection.receipts, undefined, paths.lockPath);
    }

    return {
      receipts: collection.receipts,
      totalReceipts: collection.totalReceipts,
      advanceCursor: canAdvance,
      listenerActive: activeListener,
    };
  } finally {
    if (drainLock !== null) {
      drainLock.release();
    }
  }
}

export async function msgRecvCommand(
  flags: Flags,
  context?: CommandContext,
): Promise<MsgRecvResult> {
  const actor = textFlag(flags, "actor", false);
  const wait = boolFlag(flags, "wait");
  const timeoutFlag = integerFlag(flags, "timeout", { minimum: 0 });
  const timeout = timeoutFlag !== undefined ? timeoutFlag : 5000;
  const noAdvanceCursor = boolFlag(flags, "no-advance-cursor");
  const rawAdvance = flags["advance-cursor"];
  let requestedAdvanceCursor = true;
  if (noAdvanceCursor || rawAdvance === "false") {
    requestedAdvanceCursor = false;
  }

  const type = textFlag(flags, "type", false);
  const correlationId = textFlag(flags, "correlation-id", false);
  const baseDir = textFlag(flags, "base-dir", false);
  const secret = textFlag(flags, "secret", false);

  let recipientActor = actor;
  if (recipientActor === undefined && context?.authenticatedCaller?.actor) {
    recipientActor = context.authenticatedCaller.actor;
  }
  if (recipientActor === undefined) {
    const thread = identifyExecutionContext();
    recipientActor =
      thread.agent_id !== undefined && thread.agent_id !== null ? thread.agent_id : "operator";
  }

  let readResult = executeCoordinatedRead(recipientActor, {
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
    ...(baseDir !== undefined ? { baseDir } : {}),
    requestedAdvanceCursor,
  });

  if (wait && readResult.totalReceipts === 0) {
    const startTime = Date.now();
    while (readResult.totalReceipts === 0 && Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      readResult = executeCoordinatedRead(recipientActor, {
        ...(correlationId !== undefined ? { correlationId } : {}),
        ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
        ...(baseDir !== undefined ? { baseDir } : {}),
        requestedAdvanceCursor,
      });
    }
  }

  const receivedAt = new Date().toISOString();
  const hasReceipts = readResult.totalReceipts > 0;
  const effectiveAdvance = readResult.advanceCursor;
  const deliveryStatus: "DELIVERED" | "MARKED-READ" | "UNREAD" = !hasReceipts
    ? "UNREAD"
    : effectiveAdvance
      ? "MARKED-READ"
      : "DELIVERED";

  const enrichedReceipts: readonly EnrichedReceipt[] = readResult.receipts.map((r) => {
    const isVerified = verifyEnvelopeHmac(r, secret).valid;
    const itemStatus: "DELIVERED" | "MARKED-READ" | "UNREAD" = effectiveAdvance
      ? "MARKED-READ"
      : "DELIVERED";
    const meta: ReceiptMetadata = {
      delivery_status: itemStatus,
      deliveryStatus: itemStatus,
      status: itemStatus,
      delivered: true,
      read: effectiveAdvance,
      seen: effectiveAdvance,
      cursor_advanced: effectiveAdvance,
      cursorAdvanced: effectiveAdvance,
      received_at: receivedAt,
      receivedAt,
      verified: isVerified,
      recipient: recipientActor,
      listener_active: readResult.listenerActive,
      listenerActive: readResult.listenerActive,
      coordinated: true,
    };
    return {
      ...r,
      ...meta,
      metadata: meta,
    };
  });

  const lines: string[] = [
    "### Mailbox Messages Received (`msg:recv`)",
    `- **Actor**: \`${recipientActor}\``,
    `- **Total Receipts**: \`${readResult.totalReceipts}\``,
    `- **Delivery Status**: \`${deliveryStatus}\``,
    `- **Cursor Advanced**: \`${effectiveAdvance}\``,
  ];

  if (readResult.listenerActive) {
    lines.push("- **Coordination**: `listener_active_safe_inspection`");
  }

  if (enrichedReceipts.length > 0) {
    lines.push("- **Messages**:");
    const preview = enrichedReceipts.slice(0, 5);
    for (const r of preview) {
      const shortId = r.id.length > 8 ? `${r.id.slice(0, 8)}...` : r.id;
      lines.push(`  - [\`${r.message_type}\`] from \`${r.sender_id}\` (\`${shortId}\`)`);
    }
    if (enrichedReceipts.length > 5) {
      lines.push(`  - ... and ${enrichedReceipts.length - 5} more`);
    }
  }

  return {
    markdown: enforceLineLimit(lines.join("\n"), 25),
    actor: recipientActor,
    totalReceipts: readResult.totalReceipts,
    receipts: enrichedReceipts,
    advanceCursor: effectiveAdvance,
    listenerActive: readResult.listenerActive,
    coordinated: true,
    metadata: {
      actor: recipientActor,
      totalReceipts: readResult.totalReceipts,
      advanceCursor: effectiveAdvance,
      receivedAt,
      deliveryStatus,
      listenerActive: readResult.listenerActive,
      coordinated: true,
    },
  };
}
