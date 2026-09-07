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

export interface EnrichedPollReceipt extends MailboxEnvelope {
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
  readonly listener_active?: boolean;
  readonly listenerActive?: boolean;
  readonly coordinated?: boolean;
  readonly metadata?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface MsgPollResult {
  readonly markdown: string;
  readonly actor: string;
  readonly totalReceipts: number;
  readonly receipts: readonly MailboxEnvelope[];
  readonly rounds: number;
  readonly elapsedMs: number;
  readonly advanceCursor?: boolean;
  readonly listenerActive?: boolean;
  readonly coordinated?: boolean;
  readonly metadata?: {
    readonly actor: string;
    readonly totalReceipts: number;
    readonly advanceCursor: boolean;
    readonly listenerActive: boolean;
    readonly deliveryStatus: "DELIVERED" | "MARKED-READ" | "UNREAD";
    readonly receivedAt: string;
    readonly coordinated: boolean;
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
    if (drainLock !== null) drainLock.release();
  }
}

export async function msgPollCommand(
  flags: Flags,
  context?: CommandContext,
): Promise<MsgPollResult> {
  const actor = textFlag(flags, "actor", false);
  const intervalFlag = integerFlag(flags, "interval", { minimum: 1 });
  const interval = intervalFlag !== undefined ? intervalFlag : 500;
  const timeoutFlag = integerFlag(flags, "timeout", { minimum: 0 });
  const timeout = timeoutFlag !== undefined ? timeoutFlag : 30000;
  const maxRounds = integerFlag(flags, "max-rounds", { minimum: 1 });
  const continuous = boolFlag(flags, "continuous");
  const isJson = boolFlag(flags, "json");
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

  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const abortSignal =
    context !== undefined && "signal" in context && context.signal instanceof AbortSignal
      ? context.signal
      : undefined;

  const onAbort = () => {
    interrupted = true;
  };

  if (abortSignal !== undefined) {
    if (abortSignal.aborted) interrupted = true;
    else abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  const allReceipts: EnrichedPollReceipt[] = [];
  const startTime = Date.now();
  let rounds = 0;
  let lastReadResult: CoordinatedReadResult = {
    receipts: [],
    totalReceipts: 0,
    advanceCursor: false,
    listenerActive: false,
  };

  const processBatch = (readResult: CoordinatedReadResult) => {
    lastReadResult = readResult;
    if (readResult.totalReceipts === 0) return;
    const nowIso = new Date().toISOString();
    const advanced = readResult.advanceCursor;
    const dStatus: "DELIVERED" | "MARKED-READ" | "UNREAD" = advanced ? "MARKED-READ" : "DELIVERED";

    const enrichedBatch: readonly EnrichedPollReceipt[] = readResult.receipts.map((r) => {
      const isVerified = verifyEnvelopeHmac(r, secret).valid;
      const meta = {
        delivery_status: dStatus,
        deliveryStatus: dStatus,
        status: dStatus,
        delivered: true,
        read: advanced,
        seen: advanced,
        cursor_advanced: advanced,
        cursorAdvanced: advanced,
        received_at: nowIso,
        receivedAt: nowIso,
        verified: isVerified,
        recipient: recipientActor,
        listener_active: readResult.listenerActive,
        listenerActive: readResult.listenerActive,
        coordinated: true,
      };
      return { ...r, ...meta, metadata: meta };
    });

    allReceipts.push(...enrichedBatch);
    if (continuous) {
      for (const r of enrichedBatch) {
        if (isJson) {
          process.stdout.write(`${JSON.stringify(r)}\n`);
        } else {
          const shortId = r.id.length > 8 ? `${r.id.slice(0, 8)}...` : r.id;
          process.stdout.write(
            `- [\`${r.message_type}\`] from \`${r.sender_id}\` (\`${shortId}\`)\n`,
          );
        }
      }
    }
  };

  try {
    const initialResult = executeCoordinatedRead(recipientActor, {
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
      ...(baseDir !== undefined ? { baseDir } : {}),
      requestedAdvanceCursor,
    });
    rounds += 1;
    processBatch(initialResult);

    while (continuous || allReceipts.length === 0) {
      if (maxRounds !== undefined && rounds >= maxRounds) break;
      if (timeout > 0 && Date.now() - startTime >= timeout) break;
      if (interrupted) break;
      await new Promise((resolve) => setTimeout(resolve, interval));
      if (interrupted) break;
      const pollResult = executeCoordinatedRead(recipientActor, {
        ...(correlationId !== undefined ? { correlationId } : {}),
        ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
        ...(baseDir !== undefined ? { baseDir } : {}),
        requestedAdvanceCursor,
      });
      rounds += 1;
      processBatch(pollResult);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (abortSignal !== undefined) abortSignal.removeEventListener("abort", onAbort);
  }

  const elapsedMs = Date.now() - startTime;
  const returnedReceipts = allReceipts;
  const totalReceipts = returnedReceipts.length;
  const effectiveAdvanceCursor = lastReadResult.advanceCursor;
  const hasReceipts = totalReceipts > 0;
  const deliveryStatus: "DELIVERED" | "MARKED-READ" | "UNREAD" = !hasReceipts
    ? "UNREAD"
    : effectiveAdvanceCursor
      ? "MARKED-READ"
      : "DELIVERED";

  const lines: string[] = [
    "### Mailbox Poll Result (`msg:poll`)",
    `- **Actor**: \`${recipientActor}\``,
    `- **Total Receipts**: \`${totalReceipts}\``,
    `- **Rounds Polled**: \`${rounds}\``,
    `- **Elapsed**: \`${elapsedMs}ms\``,
  ];

  if (lastReadResult.listenerActive) {
    lines.push("- **Coordination**: `listener_active_safe_inspection`");
  }

  if (returnedReceipts.length > 0) {
    lines.push("- **Messages**:");
    const preview = returnedReceipts.slice(0, 5);
    for (const r of preview) {
      const shortId = r.id.length > 8 ? `${r.id.slice(0, 8)}...` : r.id;
      lines.push(`  - [\`${r.message_type}\`] from \`${r.sender_id}\` (\`${shortId}\`)`);
    }
    if (returnedReceipts.length > 5) {
      lines.push(`  - ... and ${returnedReceipts.length - 5} more`);
    }
  }

  return {
    markdown: enforceLineLimit(lines.join("\n"), 25),
    actor: recipientActor,
    totalReceipts,
    receipts: returnedReceipts,
    rounds,
    elapsedMs,
    advanceCursor: effectiveAdvanceCursor,
    listenerActive: lastReadResult.listenerActive,
    coordinated: true,
    metadata: {
      actor: recipientActor,
      totalReceipts,
      advanceCursor: effectiveAdvanceCursor,
      listenerActive: lastReadResult.listenerActive,
      deliveryStatus,
      receivedAt: new Date().toISOString(),
      coordinated: true,
    },
  };
}
