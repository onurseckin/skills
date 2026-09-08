import { resolveActiveSession } from "../../authority/session/index.ts";
import { agentIdToRole, identifyExecutionContext } from "../../authority/thread/index.ts";
import { dispatchPeerMessage } from "../../communication/mailbox/index.ts";
import type { MailboxEnvelope, MailboxMessageType } from "../../communication/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { enforceLineLimit } from "../formatters/index.ts";
import { textFlag, type CommandContext, type Flags } from "../index.ts";

export interface CallerContext {
  readonly authenticatedCaller?: {
    readonly actor: string;
    readonly role: string;
    readonly verified: boolean;
  };
}

export interface MailboxCallerIdentity {
  readonly actor: string;
  readonly role: string;
  readonly senderId: string;
  readonly senderRole: string;
  readonly verified: boolean;
  readonly authenticatedActor?: string | undefined;
  readonly authenticatedRole?: string | undefined;
}

export function resolveMailboxCallerIdentity(
  context?: CallerContext,
  explicitActor?: string,
  explicitRole?: string,
): MailboxCallerIdentity {
  let authenticatedActor: string | undefined;
  let authenticatedRole: string | undefined;
  let verified = false;

  if (context?.authenticatedCaller?.actor) {
    authenticatedActor = context.authenticatedCaller.actor;
    authenticatedRole = context.authenticatedCaller.role;
    verified = context.authenticatedCaller.verified;
  } else {
    try {
      const session = resolveActiveSession();
      if (session) {
        authenticatedActor = session.agent_id;
        authenticatedRole = session.role;
        verified = true;
      }
    } catch {}

    if (authenticatedActor === undefined) {
      const thread = identifyExecutionContext();
      if (
        thread.agent_id !== null &&
        thread.agent_id !== undefined &&
        thread.agent_id.trim().length > 0
      ) {
        authenticatedActor = thread.agent_id.trim();
        authenticatedRole =
          thread.role !== null && thread.role !== undefined ? thread.role : undefined;
      }
    }
  }

  let actor = explicitActor?.trim();
  if (actor === undefined || actor.length === 0) {
    if (context?.authenticatedCaller !== undefined && !context.authenticatedCaller.verified) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        "--actor is required to run 'msg:send' but no verified caller identity is available; refusing to auto-fill it from an unauthenticated source.",
        [],
        3,
        "Pass --actor explicitly, or run this command from a registered session (see agent:register) so the caller's identity can be verified.",
      );
    }

    if (authenticatedActor !== undefined && verified) {
      actor = authenticatedActor;
    } else {
      const thread = identifyExecutionContext();
      actor =
        thread.agent_id !== null && thread.agent_id !== undefined ? thread.agent_id : "operator";
    }
  }

  let role = explicitRole?.trim();
  if (role === undefined || role.length === 0) {
    if (authenticatedRole !== undefined) {
      role = authenticatedRole;
    } else {
      const thread = identifyExecutionContext();
      role =
        thread.role !== null && thread.role !== undefined
          ? thread.role
          : (agentIdToRole(actor) ?? "implementer");
    }
  }

  return {
    actor,
    role,
    senderId: actor,
    senderRole: role,
    verified,
    ...(authenticatedActor !== undefined ? { authenticatedActor } : {}),
    ...(authenticatedRole !== undefined ? { authenticatedRole } : {}),
  };
}

export function validateSenderAuthority(
  callerOrContext: MailboxCallerIdentity | CallerContext | undefined,
  targetSenderId?: string,
): void {
  let identity: MailboxCallerIdentity;
  let senderIdToCheck: string;

  if (
    callerOrContext !== undefined &&
    "actor" in callerOrContext &&
    "senderId" in callerOrContext
  ) {
    identity = callerOrContext as MailboxCallerIdentity;
    senderIdToCheck = targetSenderId !== undefined ? targetSenderId.trim() : identity.senderId;
  } else {
    identity = resolveMailboxCallerIdentity(
      callerOrContext as CallerContext | undefined,
      targetSenderId,
    );
    senderIdToCheck = targetSenderId !== undefined ? targetSenderId.trim() : identity.senderId;
  }

  if (senderIdToCheck.length === 0) {
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      "Cannot send message: sender identity is empty or invalid.",
      [],
      3,
      "Specify a valid sender identity using --actor or execute within an authenticated session.",
    );
  }

  if (identity.authenticatedActor !== undefined) {
    const authActor = identity.authenticatedActor;
    const authRole = identity.authenticatedRole;
    const allowed =
      senderIdToCheck === authActor ||
      (authRole !== undefined && senderIdToCheck === authRole) ||
      (authRole !== undefined && senderIdToCheck === `agent-${authRole}`);

    if (!allowed) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        `Caller authenticated as '${authActor}' cannot send as '${senderIdToCheck}': sender identity must match an identity the caller is authorized to read from.`,
        [],
        3,
        `Send messages using your authenticated identity '${authActor}' or run as an authorized session.`,
      );
    }
  }

  try {
    const session = resolveActiveSession({ explicitActor: senderIdToCheck });
    if (
      session &&
      session.agent_id !== senderIdToCheck &&
      session.role !== senderIdToCheck &&
      senderIdToCheck !== `agent-${session.role}`
    ) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        `Caller verified as '${session.agent_id}' cannot send as '${senderIdToCheck}': sender identity must match an identity the caller is authorized to read from.`,
        [],
        3,
        `Send messages using your verified session '${session.agent_id}'.`,
      );
    }
  } catch (error) {
    if (error instanceof HarnessError && error.code === "AUTHENTICATION_FAILURE") {
      throw error;
    }
  }

  const envAgent = (
    typeof process !== "undefined"
      ? process.env["HARNESS_AGENT_ID"] || process.env["AGENT_ID"]
      : undefined
  )?.trim();
  const envRole = (
    typeof process !== "undefined"
      ? process.env["HARNESS_AGENT_ROLE"] ||
        process.env["AGENT_ROLE"] ||
        process.env["ROLE"] ||
        process.env["HARNESS_ROLE"]
      : undefined
  )?.trim();

  if (envAgent !== undefined && envAgent.length > 0) {
    const allowed =
      senderIdToCheck === envAgent ||
      (envRole !== undefined && senderIdToCheck === envRole) ||
      (envRole !== undefined && senderIdToCheck === `agent-${envRole}`);

    if (!allowed) {
      throw new HarnessError(
        "AUTHENTICATION_FAILURE",
        `Caller in environment '${envAgent}' cannot send as '${senderIdToCheck}': sender identity must match an identity the caller is authorized to read from.`,
        [],
        3,
        `Send messages using environment identity '${envAgent}'.`,
      );
    }
  }
}

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

export const VALID_MAILBOX_MESSAGE_TYPES: Record<MailboxMessageType, true> = {
  DISPATCH_TASK: true,
  HANDOFF_RECEIPT: true,
  VALIDATION_REQUEST: true,
  VALIDATION_VERDICT: true,
  COGNITIVE_PUSHBACK: true,
  PULSE_HEARTBEAT: true,
  DEFECT_ESCALATION: true,
  SYSTEM_ALERT: true,
  ACK: true,
  STATUS: true,
  QUESTION: true,
  COMPLETE: true,
  BLOCKED: true,
  DIRECTIVE: true,
  VERDICT_PASS: true,
  VERDICT_FAIL: true,
  PROTOCOL: true,
  PING: true,
  HANDSHAKE: true,
  WAKE: true,
  SOCRATIC_CHALLENGE: true,
};

function isMailboxMessageType(typeStr: string): typeStr is MailboxMessageType {
  return Object.prototype.hasOwnProperty.call(VALID_MAILBOX_MESSAGE_TYPES, typeStr);
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

  if (!isMailboxMessageType(type)) {
    const validOptions = Object.keys(VALID_MAILBOX_MESSAGE_TYPES).join(", ");
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid message type '${type}'. Valid options: ${validOptions}`,
    );
  }

  const body = textFlag(flags, "body", false);
  const payloadRaw = textFlag(flags, "payload", false);
  const actor = textFlag(flags, "actor", false);
  const role = textFlag(flags, "role", false);
  const correlationId = textFlag(flags, "correlation-id", false);
  const secret = textFlag(flags, "secret", false);
  const baseDir = textFlag(flags, "base-dir", false);

  const callerIdentity = resolveMailboxCallerIdentity(context, actor, role);
  validateSenderAuthority(callerIdentity, actor ?? callerIdentity.senderId);
  const senderId = callerIdentity.senderId;
  const senderRole = callerIdentity.senderRole;

  const payloadObj = parsePayload(payloadRaw, body);

  const envelope = dispatchPeerMessage({
    senderId,
    senderRole,
    recipientRoleOrId: to,
    messageType: type,
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
