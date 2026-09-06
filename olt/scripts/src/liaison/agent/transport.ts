import { dispatchPeerMessage } from "../../communication/mailbox/mailbox-dispatcher.ts";
import {
  advanceMailboxCursorBatch,
  loadMailboxCursor,
} from "../../communication/mailbox/cursor-tracker.ts";
import { resolveMailboxPaths } from "../../communication/mailbox/mailbox-paths.ts";
import { readUnreadMessages } from "../../communication/mailbox/mailbox-stream.ts";
import type { MailboxEnvelope } from "../../communication/types.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { evaluateEscalation, routeEscalation } from "./escalation.ts";
import { createDeliveredReceiptPayload } from "./obligation.ts";
import {
  answerPeerStateQuery,
  dispatchPeerStateResponse,
  isPeerStateQuery,
  parsePeerQuery,
} from "./query.ts";
import type {
  ContinuousDrainHandle,
  ContinuousDrainMetrics,
  ContinuousDrainOptions,
  DrainItemResult,
  LiaisonAgentId,
} from "./types.ts";

const DEFAULT_IDLE_WAIT_MS = 50;

export async function drainMailboxPass(
  options: ContinuousDrainOptions,
  metrics: ContinuousDrainMetrics,
): Promise<readonly DrainItemResult[]> {
  const agentId = options.agentId;
  const paths = resolveMailboxPaths(agentId, options.baseDir);
  const cursor = loadMailboxCursor(paths.cursorPath);

  const { messages } = readUnreadMessages(paths.inboxPath, cursor, {
    lockPath: paths.lockPath,
    quarantinePath: paths.quarantinePath,
    verifyHmac: true,
    ...(options.secretKey !== undefined ? { secretKey: options.secretKey } : {}),
  });

  if (messages.length === 0) {
    return [];
  }

  const batch = options.batchSize ? messages.slice(0, options.batchSize) : messages;
  const results: DrainItemResult[] = [];
  metrics.totalDrained += batch.length;
  metrics.lastDrainedAt = new Date().toISOString();

  for (const env of batch) {
    try {
      // 1. Emit Phase 1: RECEIPT_DELIVERED back to sender if requested
      const isReceipt =
        env.message_type === "HANDOFF_RECEIPT" || env.message_type === "PULSE_HEARTBEAT";
      if (options.emitDeliveredReceipts !== false && !isReceipt) {
        try {
          const receiptPayload = createDeliveredReceiptPayload(env.id, env.correlation_id);
          dispatchPeerMessage({
            senderId: agentId,
            senderRole: "liaison",
            recipientRoleOrId: env.sender_id,
            messageType: "HANDOFF_RECEIPT",
            payload: receiptPayload,
            correlationId: env.correlation_id,
            ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
            ...(options.secretKey !== undefined ? { secretKey: options.secretKey } : {}),
          });
          metrics.totalDeliveredReceiptsEmitted++;
        } catch {
          // Failure to deliver receipt does not drop the message
        }
      }

      // 2. Custom onMessage handler takes precedence if provided
      if (options.onMessage) {
        const itemResult = await options.onMessage(env);
        results.push(itemResult);
        metrics.totalProcessed++;
        continue;
      }

      // 3. Check for peer state queries to answer locally
      if (isPeerStateQuery(env) && options.stateProvider) {
        const query = parsePeerQuery(env);
        const resp = answerPeerStateQuery(query, options.stateProvider, agentId as LiaisonAgentId);
        dispatchPeerStateResponse(resp, agentId as LiaisonAgentId, env.sender_id, {
          ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
          ...(options.secretKey !== undefined ? { secretKey: options.secretKey } : {}),
          correlationId: env.correlation_id,
        });
        metrics.totalQueriesAnswered++;
        metrics.totalProcessed++;
        results.push({
          messageId: env.id,
          correlationId: env.correlation_id,
          status: "answered",
          detail: `Answered ${query.queryType} query`,
        });
        continue;
      }

      // 4. Check for escalation needs
      if (options.orchestratorId) {
        const escalation = evaluateEscalation(env, options.planOrState);
        if (escalation.shouldEscalate) {
          routeEscalation(env, agentId, {
            orchestratorId: options.orchestratorId,
            ...(options.orchestratorRole !== undefined
              ? { orchestratorRole: options.orchestratorRole }
              : {}),
            ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
            ...(options.secretKey !== undefined ? { secretKey: options.secretKey } : {}),
            ...(options.planOrState !== undefined ? { planOrState: options.planOrState } : {}),
          });
          metrics.totalEscalated++;
          metrics.totalProcessed++;
          results.push({
            messageId: env.id,
            correlationId: env.correlation_id,
            status: "escalated",
            detail: escalation.reason,
          });
          continue;
        }
      }

      // 5. Default delivery
      metrics.totalProcessed++;
      results.push({
        messageId: env.id,
        correlationId: env.correlation_id,
        status: "delivered",
      });
    } catch (err) {
      metrics.totalErrors++;
      if (options.onError) {
        options.onError(err);
      }
    }
  }

  // Atomically advance cursor batch for all drained messages
  if (options.autoAdvanceCursor !== false && batch.length > 0) {
    advanceMailboxCursorBatch(paths.cursorPath, batch, cursor, paths.lockPath);
  }

  metrics.cyclesCompleted++;
  return results;
}

export function startContinuousDrain(options: ContinuousDrainOptions): ContinuousDrainHandle {
  if (!options?.agentId) {
    throw new HarnessError("INVALID_ARGUMENT", "options.agentId is required for continuous drain");
  }

  const metrics: ContinuousDrainMetrics = {
    totalDrained: 0,
    totalProcessed: 0,
    totalDeliveredReceiptsEmitted: 0,
    totalEscalated: 0,
    totalQueriesAnswered: 0,
    totalErrors: 0,
    lastDrainedAt: null,
    cyclesCompleted: 0,
  };

  let isRunning = true;
  let isDraining = false;
  let pendingTrigger = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const idleMs = options.idleWaitMs ?? DEFAULT_IDLE_WAIT_MS;

  const runDrainLoop = async (): Promise<readonly DrainItemResult[]> => {
    if (isDraining) {
      pendingTrigger = true;
      return [];
    }
    isDraining = true;
    try {
      const results = await drainMailboxPass(options, metrics);
      return results;
    } finally {
      isDraining = false;
      if (isRunning) {
        if (pendingTrigger) {
          pendingTrigger = false;
          queueMicrotask(() => {
            void runDrainLoop();
          });
        } else {
          timerId = setTimeout(() => {
            void runDrainLoop();
          }, idleMs);
        }
      }
    }
  };

  // Start background event loop immediately
  queueMicrotask(() => {
    void runDrainLoop();
  });

  return {
    get isRunning() {
      return isRunning;
    },
    async stop(): Promise<void> {
      isRunning = false;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      // Wait for in-flight drain pass if active
      while (isDraining) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    getMetrics(): ContinuousDrainMetrics {
      return { ...metrics };
    },
    async triggerDrain(): Promise<readonly DrainItemResult[]> {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      while (isDraining) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return runDrainLoop();
    },
  };
}
