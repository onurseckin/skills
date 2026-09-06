import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchPeerMessage } from "../communication/mailbox/mailbox-dispatcher.ts";

export interface CanonicalMisalignmentOptions {
  readonly agentId: string;
  readonly role: string;
  readonly reason: string;
  readonly parentSupervisor?: string | undefined;
  readonly repoRoot?: string | undefined;
}

export interface CanonicalTeardownReceipt {
  readonly terminated: true;
  readonly agentId: string;
  readonly receiptCode: "SENTINEL_CANONICAL_VIOLATION";
  readonly timestamp: number;
}

const recentTeardowns: CanonicalTeardownReceipt[] = [];

export function getRecentCanonicalTeardowns(): readonly CanonicalTeardownReceipt[] {
  return [...recentTeardowns];
}

export function clearRecentCanonicalTeardowns(): void {
  recentTeardowns.length = 0;
}

export function handleCanonicalMisalignment(
  options: CanonicalMisalignmentOptions,
): CanonicalTeardownReceipt {
  const supervisor = options.parentSupervisor ?? "parent";
  const timestamp = Date.now();

  dispatchPeerMessage({
    senderId: "sentinel",
    senderRole: "sentinel",
    recipientRoleOrId: supervisor,
    messageType: "SYSTEM_ALERT",
    payload: {
      event: "SENTINEL_CANONICAL_VIOLATION",
      violation: "SENTINEL_CANONICAL_VIOLATION",
      code: "SENTINEL_CANONICAL_VIOLATION",
      agent_id: options.agentId,
      agentId: options.agentId,
      role: options.role,
      reason: options.reason,
      teardown: true,
      action: "TEARDOWN",
      timestamp,
    },
    ...(options.repoRoot ? { baseDir: options.repoRoot } : {}),
  });

  try {
    dispatchPeerMessage({
      senderId: "sentinel",
      senderRole: "sentinel",
      recipientRoleOrId: options.agentId,
      messageType: "SYSTEM_ALERT",
      payload: {
        event: "SENTINEL_CANONICAL_VIOLATION",
        action: "TERMINATE",
        signal: "SIGTERM",
        reason: options.reason,
        timestamp,
      },
      ...(options.repoRoot ? { baseDir: options.repoRoot } : {}),
    });
  } catch {}

  if (options.repoRoot) {
    try {
      const qDir = join(options.repoRoot, ".olt", "quarantine");
      if (!existsSync(qDir)) mkdirSync(qDir, { recursive: true });
      writeFileSync(
        join(qDir, `${options.agentId}.teardown.json`),
        JSON.stringify(
          {
            agentId: options.agentId,
            role: options.role,
            reason: options.reason,
            code: "SENTINEL_CANONICAL_VIOLATION",
            timestamp,
          },
          null,
          2,
        ),
        "utf-8",
      );
    } catch {}
  }

  const receipt: CanonicalTeardownReceipt = {
    terminated: true,
    agentId: options.agentId,
    receiptCode: "SENTINEL_CANONICAL_VIOLATION",
    timestamp,
  };

  recentTeardowns.push(receipt);
  return receipt;
}
