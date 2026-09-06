import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { appendMailboxMessage, createSignedEnvelope } from "../communication/mailbox/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import type { AgentRole, RoutingJourney, SentinelViolation } from "./types.ts";

export interface MailboxInterjectionOptions {
  readonly originSentinel: string;
  readonly originRole: AgentRole;
  readonly targetAgent: string;
  readonly targetRole: AgentRole;
  readonly parentSupervisor?: string | undefined;
  readonly currentStrike: number;
  readonly violations: readonly SentinelViolation[];
  readonly markdownBrief: string;
  readonly repoRoot?: string | undefined;
  readonly secretKey?: string | undefined;
}

export interface MailboxDispatchResult {
  readonly deliveredTo: string;
  readonly mailboxPath: string;
  readonly routingJourney: RoutingJourney;
  readonly envelopeId: string;
}

const inMemoryDispatches: MailboxDispatchResult[] = [];
let inMemoryRouterMode = false;

export function setInMemoryRouterMode(enabled: boolean): void {
  inMemoryRouterMode = enabled;
}

export function clearInMemoryDispatches(): void {
  inMemoryDispatches.length = 0;
}

export function getInMemoryDispatches(): readonly MailboxDispatchResult[] {
  return [...inMemoryDispatches];
}

export function generateRoutingJourney(options: {
  originSentinel: string;
  originRole: AgentRole;
  ruleCode: string;
  targetAgent: string;
  targetRole: AgentRole;
  parentSupervisor: string;
  currentStrike: number;
  escalated: boolean;
  timestamp?: number | undefined;
}): RoutingJourney {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const rawData = `${options.originSentinel}|${options.originRole}|${options.ruleCode}|${options.targetAgent}|${options.targetRole}|${options.parentSupervisor}|${options.currentStrike}|${options.escalated}|${timestamp}`;
  const sha256 = createHash("sha256").update(rawData).digest("hex");

  return {
    origin_sentinel: options.originSentinel,
    origin_role: options.originRole,
    rule_code: options.ruleCode,
    target_agent: options.targetAgent,
    target_role: options.targetRole,
    parent_supervisor: options.parentSupervisor,
    current_strike: options.currentStrike,
    escalated: options.escalated,
    timestamp,
    sha256,
  };
}

export function dispatchSentinelInterjection(
  options: MailboxInterjectionOptions,
): MailboxDispatchResult {
  const root = options.repoRoot ? resolve(options.repoRoot) : process.cwd();
  const escalated = options.currentStrike >= 3;
  const targetRecipient = escalated
    ? (options.parentSupervisor ?? "coordinator_core")
    : options.targetAgent;

  // Zero-Cross-Tier Routing Invariant Check:
  // Non-escalated messages (Strikes 1 and 2) MUST NEVER be addressed to supervisor
  if (!escalated && targetRecipient !== options.targetAgent) {
    throw new HarnessError(
      "ROLE_BOUNDARY_DEVIATION",
      `UNAUTHORIZED_BROADCAST_POLLUTION: Strike ${options.currentStrike} advisory must be delivered strictly to target agent '${options.targetAgent}', not '${targetRecipient}'.`,
    );
  }

  const primaryRuleCode = options.violations[0]?.code ?? "GENERAL_INVARIANT_BREACH";
  const routingJourney = generateRoutingJourney({
    originSentinel: options.originSentinel,
    originRole: options.originRole,
    ruleCode: primaryRuleCode,
    targetAgent: options.targetAgent,
    targetRole: options.targetRole,
    parentSupervisor: options.parentSupervisor ?? "supervisor",
    currentStrike: options.currentStrike,
    escalated,
  });

  const payload: Record<string, unknown> = {
    routing_journey: routingJourney,
    strike_count: options.currentStrike,
    escalated,
    violations: options.violations,
    markdown_brief: options.markdownBrief,
  };

  const envelope = createSignedEnvelope({
    senderId: options.originSentinel,
    senderRole: options.originRole,
    recipientId: targetRecipient,
    messageType: escalated ? "DEFECT_ESCALATION" : "SYSTEM_ALERT",
    payload,
    ...(options.secretKey ? { secretKey: options.secretKey } : {}),
  });

  const mailboxDir = join(root, ".olt", "mailboxes", targetRecipient);
  const inboxPath = join(mailboxDir, "inbox.jsonl");
  const lockPath = join(root, ".olt", "locks", "mailboxes", `${targetRecipient}.lock`);
  const notifyPath = join(mailboxDir, ".notify");

  if (inMemoryRouterMode) {
    const result: MailboxDispatchResult = {
      deliveredTo: targetRecipient,
      mailboxPath: inboxPath,
      routingJourney,
      envelopeId: envelope.id,
    };
    inMemoryDispatches.push(result);
    return result;
  }

  try {
    const lockDir = dirname(lockPath);
    if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });
    if (!existsSync(mailboxDir)) mkdirSync(mailboxDir, { recursive: true });

    appendMailboxMessage(inboxPath, envelope, lockPath);

    // Touch notification signal file
    try {
      writeFileSync(notifyPath, `${Date.now()}:${envelope.id}\n`, "utf-8");
    } catch {}
  } catch (error) {
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `Failed to deliver sentinel interjection to '${targetRecipient}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result: MailboxDispatchResult = {
    deliveredTo: targetRecipient,
    mailboxPath: inboxPath,
    routingJourney,
    envelopeId: envelope.id,
  };

  inMemoryDispatches.push(result);
  return result;
}
