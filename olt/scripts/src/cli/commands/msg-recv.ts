import { identifyExecutionContext } from "../../authority/thread/index.ts";
import { collectInboxReceipts } from "../../communication/mailbox/index.ts";
import type { MailboxEnvelope, MailboxMessageType } from "../../communication/types.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MsgRecvResult {
  readonly markdown: string;
  readonly actor: string;
  readonly totalReceipts: number;
  readonly receipts: readonly MailboxEnvelope[];
  readonly [key: string]: unknown;
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

  let collection = collectInboxReceipts(recipientActor, {
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
    ...(baseDir !== undefined ? { baseDir } : {}),
    advanceCursor,
  });

  if (wait && collection.totalReceipts === 0) {
    const startTime = Date.now();
    while (collection.totalReceipts === 0 && Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      collection = collectInboxReceipts(recipientActor, {
        ...(correlationId !== undefined ? { correlationId } : {}),
        ...(type !== undefined ? { messageType: type as MailboxMessageType } : {}),
        ...(baseDir !== undefined ? { baseDir } : {}),
        advanceCursor,
      });
    }
  }

  const lines: string[] = [
    "### Mailbox Messages Received (`msg:recv`)",
    `- **Actor**: \`${recipientActor}\``,
    `- **Total Receipts**: \`${collection.totalReceipts}\``,
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
  };
}
