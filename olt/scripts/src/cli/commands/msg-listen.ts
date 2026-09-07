import { identifyExecutionContext } from "../../authority/thread/index.ts";
import type { MailboxEnvelope } from "../../communication/index.ts";
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

  const messages: MailboxEnvelope<unknown>[] = [];
  const startTime = Date.now();

  let stopResolve: () => void = () => {};
  const stopPromise = new Promise<void>((resolve) => {
    stopResolve = resolve;
  });

  const onSignal = () => {
    stopResolve();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

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
    ...(batchSize !== undefined ? { batchSize } : {}),
    ...(baseDir !== undefined ? { baseDir } : {}),
    ...(secretKey !== undefined ? { secretKey } : {}),
    emitDeliveredReceipts: false,
    onMessage: (env) => {
      messages.push(env);
      if (isJson) {
        process.stdout.write(`${JSON.stringify(env)}\n`);
      } else {
        const shortId = env.id.length > 8 ? `${env.id.slice(0, 8)}...` : env.id;
        process.stdout.write(
          `- [\`${env.message_type}\`] from \`${env.sender_id}\` (\`${shortId}\`)\n`,
        );
      }
      if (maxMessages !== undefined && messages.length >= maxMessages) {
        stopResolve();
      }
      return {
        messageId: env.id,
        correlationId: env.correlation_id,
        status: "delivered",
      };
    },
  });

  try {
    await stopPromise;
  } finally {
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
