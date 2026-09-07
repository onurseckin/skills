import { identifyExecutionContext } from "../../authority/thread/index.ts";
import { collectInboxReceipts } from "../../communication/mailbox/index.ts";
import type { MailboxEnvelope, MailboxMessageType } from "../../communication/types.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MsgPollResult {
  readonly markdown: string;
  readonly actor: string;
  readonly totalReceipts: number;
  readonly receipts: readonly MailboxEnvelope[];
  readonly rounds: number;
  readonly elapsedMs: number;
  readonly [key: string]: unknown;
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
  let advanceCursor = true;
  if (noAdvanceCursor) {
    advanceCursor = false;
  } else if (rawAdvance === "false") {
    advanceCursor = false;
  }

  const type = textFlag(flags, "type", false);
  const correlationId = textFlag(flags, "correlation-id", false);
  const baseDir = textFlag(flags, "base-dir", false);

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
    if (abortSignal.aborted) {
      interrupted = true;
    } else {
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const allReceipts: MailboxEnvelope[] = [];
  const startTime = Date.now();
  let rounds = 0;

  try {
    let collection = collectInboxReceipts(recipientActor, {
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
      ...(baseDir !== undefined ? { baseDir } : {}),
      advanceCursor,
    });
    rounds += 1;

    if (collection.totalReceipts > 0) {
      allReceipts.push(...collection.receipts);
      if (continuous) {
        for (const r of collection.receipts) {
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
    }

    while (continuous || allReceipts.length === 0) {
      if (maxRounds !== undefined && rounds >= maxRounds) {
        break;
      }
      if (timeout > 0 && Date.now() - startTime >= timeout) {
        break;
      }
      if (interrupted) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
      if (interrupted) {
        break;
      }
      collection = collectInboxReceipts(recipientActor, {
        ...(correlationId !== undefined ? { correlationId } : {}),
        ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
        ...(baseDir !== undefined ? { baseDir } : {}),
        advanceCursor,
      });
      rounds += 1;

      if (collection.totalReceipts > 0) {
        allReceipts.push(...collection.receipts);
        if (continuous) {
          for (const r of collection.receipts) {
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
      }
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (abortSignal !== undefined) {
      abortSignal.removeEventListener("abort", onAbort);
    }
  }

  const elapsedMs = Date.now() - startTime;
  const returnedReceipts = allReceipts;
  const totalReceipts = returnedReceipts.length;

  const lines: string[] = [
    "### Mailbox Poll Result (`msg:poll`)",
    `- **Actor**: \`${recipientActor}\``,
    `- **Total Receipts**: \`${totalReceipts}\``,
    `- **Rounds Polled**: \`${rounds}\``,
    `- **Elapsed**: \`${elapsedMs}ms\``,
  ];

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
  };
}
