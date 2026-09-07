import { identifyExecutionContext } from "../../authority/thread/index.ts";
import {
  acquireMailboxLock,
  isInMemoryLocking,
  releaseInMemoryLock,
  releaseMailboxLock,
  tryAcquireInMemoryLock,
} from "../../communication/locking/index.ts";
import {
  advanceMailboxCursor,
  ensureMailboxDirectories,
  isListenerAlive,
  isMessageProcessed,
  isVirtualMailboxPath,
  loadMailboxCursor,
  recordListenerHeartbeat,
  removeListenerHeartbeat,
  resolveMailboxPaths,
} from "../../communication/mailbox/index.ts";
import type { MailboxEnvelope } from "../../communication/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { startContinuousDrain, type ContinuousDrainMetrics } from "../../liaison/agent/index.ts";
import { enforceLineLimit } from "../formatters/index.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../index.ts";
import { registerShutdownHook } from "../signals/index.ts";

export interface MsgListenResult {
  readonly markdown: string;
  readonly actor: string;
  readonly totalDrained: number;
  readonly totalReceipts: number;
  readonly messages: readonly MailboxEnvelope<unknown>[];
  readonly receipts: readonly MailboxEnvelope<unknown>[];
  readonly elapsedMs: number;
  readonly metrics?: ContinuousDrainMetrics;
  readonly [key: string]: unknown;
}

export interface MsgListenContext extends CommandContext {
  readonly signal?: AbortSignal | undefined;
}

interface DrainLockHandle {
  readonly acquired: boolean;
  readonly holderPid: number | null;
  readonly release: () => void;
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
      release: () => {
        releaseInMemoryLock(lockPath, fd);
      },
    };
  }
  const res = acquireMailboxLock(lockPath, holderId, { timeoutMs: 0 });
  if (!res.acquired) {
    return { acquired: false, holderPid: res.holderPid, release: () => {} };
  }
  return {
    acquired: true,
    holderPid: res.holderPid,
    release: () => {
      releaseMailboxLock(res);
    },
  };
}

function writeStdoutConfirmed(text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let resolved = false;
    const cleanup = () => {
      process.stdout.off("error", onError);
      process.stdout.off("drain", onDrain);
    };
    const onError = (err: unknown) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(err);
      }
    };
    const onDrain = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve();
      }
    };
    process.stdout.once("error", onError);
    let flushed = false;
    const canContinue = process.stdout.write(text, (err) => {
      if (err) {
        onError(err);
        return;
      }
      flushed = true;
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve();
      }
    });
    if (flushed && !resolved) {
      resolved = true;
      cleanup();
      resolve();
    } else if (!canContinue && !resolved) {
      process.stdout.once("drain", onDrain);
    }
  });
}

export async function msgListenCommand(
  flags: Flags,
  context?: CommandContext | MsgListenContext,
): Promise<MsgListenResult> {
  const actor = textFlag(flags, "actor", false);
  const intervalFlag = integerFlag(flags, "interval", { minimum: 1 });
  const idleWaitMs = intervalFlag !== undefined ? intervalFlag : 50;
  const batchSize = integerFlag(flags, "batch-size", { minimum: 1 });
  const baseDir = textFlag(flags, "base-dir", false);
  const secretKey = textFlag(flags, "secret", false);
  const isJson = boolFlag(flags, "json");
  const timeoutFlag = integerFlag(flags, "timeout", { minimum: 0 });
  const maxMessages = integerFlag(flags, "max-messages", { minimum: 1 });

  let recipientActor = actor;
  if (
    recipientActor === undefined &&
    context !== undefined &&
    context.authenticatedCaller !== undefined &&
    context.authenticatedCaller.actor
  ) {
    recipientActor = context.authenticatedCaller.actor;
  }
  if (recipientActor === undefined) {
    const thread = identifyExecutionContext();
    recipientActor =
      thread.agent_id !== undefined && thread.agent_id !== null ? thread.agent_id : "operator";
  }

  const paths = resolveMailboxPaths(recipientActor, baseDir);
  ensureMailboxDirectories(paths);

  if (isListenerAlive(recipientActor, baseDir !== undefined ? { baseDir } : undefined)) {
    throw new HarnessError(
      "INVALID_STATE",
      `Concurrent reader collision: active listener already running for actor '${recipientActor}'.`,
    );
  }

  const drainLockPath = paths.lockPath.endsWith(".lock")
    ? `${paths.lockPath.slice(0, -5)}.drain.lock`
    : `${paths.lockPath}.drain.lock`;

  const drainLock = acquireDrainLock(drainLockPath, `listener-${recipientActor}-${process.pid}`);
  if (!drainLock.acquired) {
    throw new HarnessError(
      "INVALID_STATE",
      `Concurrent reader collision: mailbox for actor '${recipientActor}' is already locked by an active drain (holder PID: ${drainLock.holderPid ?? "unknown"}).`,
    );
  }

  recordListenerHeartbeat(recipientActor, {
    ...(baseDir !== undefined ? { baseDir } : {}),
    pid: process.pid,
  });

  const messages: MailboxEnvelope<unknown>[] = [];
  const startTime = Date.now();
  let deliveryError: unknown = undefined;

  let stopResolve: () => void = () => {};
  const stopPromise = new Promise<void>((resolve) => {
    stopResolve = resolve;
  });

  const onSignal = () => {
    stopResolve();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const onStdoutError = (err: unknown) => {
    deliveryError = deliveryError ?? err;
    stopResolve();
  };
  process.stdout.on("error", onStdoutError);

  const unregisterShutdown = registerShutdownHook(async () => {
    stopResolve();
  });

  const abortSignal =
    context !== undefined && "signal" in context && context.signal instanceof AbortSignal
      ? context.signal
      : undefined;

  const onAbort = () => {
    stopResolve();
  };

  if (abortSignal !== undefined) {
    if (abortSignal.aborted) {
      stopResolve();
    } else {
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutFlag !== undefined && timeoutFlag > 0) {
    timeoutTimer = setTimeout(stopResolve, timeoutFlag);
  }

  const handle = startContinuousDrain({
    agentId: recipientActor,
    idleWaitMs,
    autoAdvanceCursor: false,
    ...(batchSize !== undefined ? { batchSize } : {}),
    ...(baseDir !== undefined ? { baseDir } : {}),
    ...(secretKey !== undefined ? { secretKey } : {}),
    emitDeliveredReceipts: false,
    onMessage: async (env) => {
      if (deliveryError !== undefined) {
        throw deliveryError;
      }
      const currentCursor = loadMailboxCursor(paths.cursorPath);
      if (isMessageProcessed(env, currentCursor)) {
        return {
          messageId: env.id,
          correlationId: env.correlation_id,
          status: "delivered",
        };
      }
      const output = isJson
        ? `${JSON.stringify(env)}\n`
        : (() => {
            const shortId = env.id.length > 8 ? `${env.id.slice(0, 8)}...` : env.id;
            return `- [\`${env.message_type}\`] from \`${env.sender_id}\` (\`${shortId}\`)\n`;
          })();
      try {
        await writeStdoutConfirmed(output);
        messages.push(env);
      } catch (err) {
        deliveryError = err;
        stopResolve();
        throw err;
      }

      advanceMailboxCursor(paths.cursorPath, env, undefined, paths.lockPath);
      recordListenerHeartbeat(recipientActor, {
        ...(baseDir !== undefined ? { baseDir } : {}),
        pid: process.pid,
        lastDeliveredTimestamp: new Date().toISOString(),
      });

      if (maxMessages !== undefined && messages.length >= maxMessages) {
        stopResolve();
      }
      return {
        messageId: env.id,
        correlationId: env.correlation_id,
        status: "delivered",
      };
    },
    onError: (err) => {
      deliveryError = deliveryError ?? err;
      stopResolve();
    },
  });

  try {
    await stopPromise;
  } finally {
    process.stdout.off("error", onStdoutError);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    unregisterShutdown();
    if (abortSignal !== undefined) {
      abortSignal.removeEventListener("abort", onAbort);
    }
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
    }
    await handle.stop();
    removeListenerHeartbeat(recipientActor, baseDir);
    drainLock.release();
  }

  if (deliveryError !== undefined) {
    throw deliveryError;
  }

  const elapsedMs = Date.now() - startTime;
  const metrics = handle.getMetrics();

  const lines: string[] = [
    "### Mailbox Continuous Listen Result (`msg:listen`)",
    `- **Actor**: \`${recipientActor}\``,
    `- **Total Drained**: \`${messages.length}\``,
    `- **Elapsed**: \`${elapsedMs}ms\``,
  ];

  if (messages.length > 0) {
    lines.push("- **Messages**:");
    const preview = messages.slice(0, 5);
    for (const r of preview) {
      const shortId = r.id.length > 8 ? `${r.id.slice(0, 8)}...` : r.id;
      lines.push(`  - [\`${r.message_type}\`] from \`${r.sender_id}\` (\`${shortId}\`)`);
    }
    if (messages.length > 5) {
      lines.push(`  - ... and ${messages.length - 5} more`);
    }
  }

  return {
    markdown: enforceLineLimit(lines.join("\n"), 25),
    actor: recipientActor,
    totalDrained: messages.length,
    totalReceipts: messages.length,
    messages,
    receipts: messages,
    elapsedMs,
    metrics,
  };
}
