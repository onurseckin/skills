import { identifyExecutionContext } from "../../authority/thread/index.ts";
import { dispatchPeerMessage } from "../../communication/mailbox/index.ts";
import type { MailboxEnvelope, MailboxMessageType } from "../../communication/types.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MsgSendResult {
  readonly markdown: string;
  readonly envelope: MailboxEnvelope;
  readonly [key: string]: unknown;
}

function parsePayload(
  payloadRaw: string | undefined,
  body: string | undefined,
): Record<string, unknown> {
  let payloadObj: Record<string, unknown> = {};
  if (payloadRaw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(payloadRaw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        payloadObj = { ...(parsed as Record<string, unknown>) };
      } else {
        payloadObj = { value: parsed };
      }
    } catch {
      payloadObj = { text: payloadRaw };
    }
  }
  if (body !== undefined) {
    payloadObj = { ...payloadObj, body };
  }
  return payloadObj;
}

export function msgSendCommand(flags: Flags, context?: CommandContext): MsgSendResult {
  const to = textFlag(flags, "to", true);
  if (to === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "--to is required");
  }

  const type = textFlag(flags, "type", true);
  if (type === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "--type is required");
  }

  const body = textFlag(flags, "body", false);
  const payloadRaw = textFlag(flags, "payload", false);
  const actor = textFlag(flags, "actor", false);
  const role = textFlag(flags, "role", false);
  const correlationId = textFlag(flags, "correlation-id", false);
  const secret = textFlag(flags, "secret", false);
  const baseDir = textFlag(flags, "base-dir", false);

  let senderId = actor;
  if (
    senderId === undefined &&
    context !== undefined &&
    context.authenticatedCaller !== undefined &&
    context.authenticatedCaller.actor
  ) {
    senderId = context.authenticatedCaller.actor;
  }
  if (senderId === undefined) {
    const thread = identifyExecutionContext();
    senderId =
      thread.agent_id !== undefined && thread.agent_id !== null ? thread.agent_id : "operator";
  }

  let senderRole = role;
  if (
    senderRole === undefined &&
    context !== undefined &&
    context.authenticatedCaller !== undefined &&
    context.authenticatedCaller.role
  ) {
    senderRole = context.authenticatedCaller.role;
  }
  if (senderRole === undefined) {
    const thread = identifyExecutionContext();
    senderRole = thread.role !== undefined && thread.role !== null ? thread.role : "implementer";
  }

  const payloadObj = parsePayload(payloadRaw, body);

  const envelope = dispatchPeerMessage({
    senderId,
    senderRole,
    recipientRoleOrId: to,
    messageType: type as MailboxMessageType,
    payload: payloadObj,
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(secret !== undefined ? { secretKey: secret } : {}),
    ...(baseDir !== undefined ? { baseDir } : {}),
  });

  const corrDisplay = envelope.correlation_id !== undefined ? envelope.correlation_id : "none";
  const sigPreview = `${envelope.hmac_signature.slice(0, 16)}...`;

  const lines: string[] = [
    "### Mailbox Message Dispatched (`msg:send`)",
    `- **Message ID**: \`${envelope.id}\``,
    `- **Sender**: \`${envelope.sender_id}\` (\`${envelope.sender_role}\`)`,
    `- **Recipient**: \`${envelope.recipient_id}\``,
    `- **Type**: \`${envelope.message_type}\``,
    `- **Correlation ID**: \`${corrDisplay}\``,
    `- **Timestamp**: \`${envelope.timestamp}\``,
    `- **HMAC Signature**: \`${sigPreview}\``,
  ];

  return {
    markdown: enforceLineLimit(lines.join("\n"), 25),
    envelope,
    message_id: envelope.id,
    id: envelope.id,
    sender_id: envelope.sender_id,
    sender_role: envelope.sender_role,
    recipient_id: envelope.recipient_id,
    message_type: envelope.message_type,
    correlation_id: envelope.correlation_id,
    timestamp: envelope.timestamp,
  };
}
