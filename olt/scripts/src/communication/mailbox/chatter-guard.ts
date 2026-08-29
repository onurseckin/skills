import { HarnessError } from "../../core/errors/index.ts";
import type {
  ChatterGuardOptions,
  FilteredNarrationResult,
  MailboxEnvelope,
  MailboxMessageType,
} from "../types.ts";
import { createSignedEnvelope } from "./envelope.ts";
import { ensureMailboxDirectories, resolveMailboxPaths } from "./mailbox-paths.ts";
import { appendMailboxMessage } from "./mailbox-stream.ts";

export interface AssertNonChatterPolicyContext {
  readonly senderId?: string;
  readonly recipientRoleOrId?: string;
  readonly isInteractiveSeat?: boolean;
}

export interface RouteStatusUpdateOptions {
  readonly baseDir?: string;
  readonly secretKey?: string;
  readonly messageType?: MailboxMessageType;
  readonly senderRole?: string;
}

const HUMAN_INTERACTIVE_RECIPIENTS = new Set([
  "human",
  "user",
  "stdout",
  "interactive",
  "console",
  "terminal",
  "owner",
  "main-thread",
]);

const MID_FLIGHT_PATTERNS: readonly RegExp[] = [
  /^\s*\[?(?:status|progress|pulse|heartbeat|mid-flight)\s*(?:update|report|ping|check|notice)?\]?\s*:/i,
  /\b(?:status|progress|mid-flight|pulse|heartbeat)\s+(?:update|report|ping|check|notice)\b/i,
  /^\s*(?:status|progress)\s*:/i,
  /\bstatus\s+update\s*:/i,
  /\bprogress\s+update\s*:/i,
  /\bstep\s+\d+\s*(?:\/|\s+of\s+)\s*\d+/i,
  /\bstep\s+\d+\s*:\s*(?:in\s+progress|started|starting|executing|complete|done)/i,
  /\b(?:now\s+)?executing\s+step\b/i,
  /\bstep\s+\d+\s+(?:complete|in\s+progress|started|finished)\b/i,
  /\b(?:i am|i'm|currently)\s+(?:now\s+)?(?:executing|running|dispatching|processing|working on|performing|inspecting|analyzing|verifying|reading|writing|compiling|building|testing|launching)\b/i,
  /\b(?:now\s+)?(?:executing|running|dispatching|spawning)\s+(?:task|agent|subagent|worker|tool|command|process|script)\b/i,
  /\bworker\s+(?:dispatched|assigned|spawned|started|running|working|completed)\b/i,
  /\bagent\s+(?:dispatched|assigned|spawned|started|running)\b/i,
  /\b(?:dispatching|spawning)\s+(?:subagent|worker|agent|task)\b/i,
  /\bwaiting\s+for\s+(?:subagent|worker|agent|task\s+completion|output|result)\b/i,
  /\bheartbeat\s+(?:ping|pulse|ack|alive)\b/i,
  /\bmid-flight\s+(?:narration|update|status|execution|progress)\b/i,
];

function isHumanOrStdoutRecipient(recipient?: string): boolean {
  if (typeof recipient !== "string" || recipient.trim().length === 0) {
    return false;
  }
  return HUMAN_INTERACTIVE_RECIPIENTS.has(recipient.trim().toLowerCase());
}

export function isMidFlightNarration(text: string): boolean {
  if (typeof text !== "string" || text.trim().length === 0) {
    return false;
  }
  const trimmed = text.trim();
  for (const pattern of MID_FLIGHT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  return false;
}

export function assertNonChatterPolicy(
  text: string,
  context?: AssertNonChatterPolicyContext,
): void {
  if (typeof text !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "text must be a string");
  }

  const isInteractive =
    context?.isInteractiveSeat === true ||
    (context?.isInteractiveSeat === undefined &&
      (context?.recipientRoleOrId === undefined ||
        isHumanOrStdoutRecipient(context.recipientRoleOrId)));

  if (isInteractive && isMidFlightNarration(text)) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      "Mid-flight chatter policy violation: supervisory progress narration must be routed to file mailboxes, not human stdout",
    );
  }
}

export function routeStatusUpdate<T>(
  agentId: string,
  parentId: string,
  statusPayload: T,
  options?: RouteStatusUpdateOptions,
): MailboxEnvelope<T> {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (typeof parentId !== "string" || parentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "parentId must be a non-empty string");
  }

  const parentPaths = resolveMailboxPaths(parentId, options?.baseDir);
  ensureMailboxDirectories(parentPaths);

  const senderPaths = resolveMailboxPaths(agentId, options?.baseDir);
  ensureMailboxDirectories(senderPaths);

  const messageType = options?.messageType ?? "PULSE_HEARTBEAT";
  const envelope = createSignedEnvelope<T>({
    senderId: agentId,
    senderRole: options?.senderRole ?? "worker",
    recipientId: parentId,
    messageType,
    payload: statusPayload,
    ...(options?.secretKey !== undefined ? { secretKey: options.secretKey } : {}),
  });

  appendMailboxMessage(parentPaths.inboxPath, envelope, parentPaths.lockPath);
  appendMailboxMessage(senderPaths.outboxPath, envelope, senderPaths.lockPath);

  return envelope;
}

export function filterHumanRelayNarration(
  text: string,
  options: ChatterGuardOptions,
): FilteredNarrationResult {
  if (typeof text !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "text must be a string");
  }
  if (!options || typeof options !== "object") {
    throw new HarnessError("INVALID_ARGUMENT", "options must be an object");
  }
  if (typeof options.agentId !== "string" || options.agentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "options.agentId must be a non-empty string");
  }
  if (typeof options.parentId !== "string" || options.parentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "options.parentId must be a non-empty string");
  }

  if (!isMidFlightNarration(text)) {
    return {
      isNarration: false,
      filteredText: text,
    };
  }

  const payload = {
    rawNarration: text,
    agentId: options.agentId,
    timestamp: new Date().toISOString(),
  };

  const routedEnvelope = routeStatusUpdate(options.agentId, options.parentId, payload, {
    ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
    ...(options.secretKey !== undefined ? { secretKey: options.secretKey } : {}),
    messageType: "PULSE_HEARTBEAT",
  });

  return {
    isNarration: true,
    filteredText: "[Status update routed to supervisor mailbox]",
    routedEnvelope,
  };
}
