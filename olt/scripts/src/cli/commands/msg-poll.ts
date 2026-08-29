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

  const startTime = Date.now();
  let rounds = 0;
  let collection = collectInboxReceipts(recipientActor, {
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
    ...(baseDir !== undefined ? { baseDir } : {}),
    advanceCursor,
  });
  rounds += 1;

  while (collection.totalReceipts === 0) {
    if (maxRounds !== undefined && rounds >= maxRounds) {
      break;
    }
    if (Date.now() - startTime >= timeout) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    collection = collectInboxReceipts(recipientActor, {
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
      ...(baseDir !== undefined ? { baseDir } : {}),
      advanceCursor,
    });
    rounds += 1;
  }

  const elapsedMs = Date.now() - startTime;

  const lines: string[] = [
    "### Mailbox Poll Result (`msg:poll`)",
    `- **Actor**: \`${recipientActor}\``,
    `- **Total Receipts**: \`${collection.totalReceipts}\``,
    `- **Rounds Polled**: \`${rounds}\``,
    `- **Elapsed**: \`${elapsedMs}ms\``,
  ];

  if (collection.receipts.length > 0) {
    lines.push("- **Messages**:");
    const preview = collection.receipts.slice(0, 5);
    for (const r of preview) {
      const shortId = r.id.length > 8 ? `${r.id.slice(0, 8)}...` : r.id;
      lines.push(`  - [\`${r.message_type}\`] from \`${r.sender_id}\` (\`${shortId}\`)`);
    }
    if (collection.receipts.length > 5) {
      lines.push(`  - ... and ${collection.receipts.length - 5} more`);
    }
  }

  return {
    markdown: enforceLineLimit(lines.join("\n"), 25),
    actor: recipientActor,
    totalReceipts: collection.totalReceipts,
    receipts: collection.receipts,
    rounds,
    elapsedMs,
  };
}
