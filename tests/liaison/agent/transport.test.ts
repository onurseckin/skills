import { beforeEach, describe, expect, test } from "bun:test";
import { clearInMemoryCursors } from "../../../olt/scripts/src/communication/mailbox/cursor-tracker.ts";
import { dispatchPeerMessage } from "../../../olt/scripts/src/communication/mailbox/mailbox-dispatcher.ts";
import {
  clearInMemoryMailboxStore,
  setInMemoryStreamMode,
} from "../../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  drainMailboxPass,
  startContinuousDrain,
  type ContinuousDrainMetrics,
  type ContinuousDrainOptions,
  type LiaisonStateProvider,
  type PlanOrState,
} from "../../../olt/scripts/src/liaison/agent/index.ts";

describe("Continuous Mailbox Drain Transport Engine", () => {
  const baseDir = "virtual:drain-cluster";
  const liaisonId = "liaison_claude" as const;
  const peerId = "liaison_antigravity";
  const orchestratorId = "orchestrator_main";

  const mockStateProvider: LiaisonStateProvider = {
    getLiveness: () => ({ status: "alive", uptime: 100 }),
    getRunState: () => ({ runId: "r-1", status: "running" }),
    getLaneStatus: () => ({ laneId: "l-1", status: "active" }),
    getRoster: () => [{ id: "liaison_claude", role: "liaison" }],
    getObligationStatus: () => ({ status: "bound" }),
    getMetrics: () => ({ score: 100 }),
  };

  const mockPlan: PlanOrState = {
    runId: "r-1",
    lanes: [
      {
        laneId: "task-1",
        runId: "r-1",
        writeScope: ["src/feature-a"],
      },
    ],
  };

  beforeEach(() => {
    setInMemoryStreamMode(true);
    clearInMemoryMailboxStore();
    clearInMemoryCursors();
  });

  test("drainMailboxPass reads inbox, emits delivered receipt, and advances cursor", async () => {
    // Send message from peer to liaison
    dispatchPeerMessage({
      senderId: peerId,
      senderRole: "liaison",
      recipientRoleOrId: liaisonId,
      messageType: "SYSTEM_ALERT",
      payload: { ping: "hello" },
      correlationId: "c-100",
      baseDir,
    });

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

    const opts: ContinuousDrainOptions = {
      agentId: liaisonId,
      baseDir,
      emitDeliveredReceipts: true,
      orchestratorId,
      planOrState: mockPlan,
    };

    const results = await drainMailboxPass(opts, metrics);
    expect(results.length).toBe(1);
    expect(metrics.totalDrained).toBe(1);
    expect(metrics.totalProcessed).toBe(1);
    expect(metrics.totalDeliveredReceiptsEmitted).toBe(1);
    expect(metrics.totalEscalated).toBe(1); // SYSTEM_ALERT escalates

    // Second pass should see 0 unread messages because cursor was advanced
    const secondPass = await drainMailboxPass(opts, metrics);
    expect(secondPass.length).toBe(0);
  });

  test("drainMailboxPass answers peer queries locally without escalating", async () => {
    dispatchPeerMessage({
      senderId: peerId,
      senderRole: "liaison",
      recipientRoleOrId: liaisonId,
      messageType: "PULSE_HEARTBEAT",
      payload: { queryType: "LIVENESS" },
      correlationId: "c-live",
      baseDir,
    });

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

    const opts: ContinuousDrainOptions = {
      agentId: liaisonId,
      baseDir,
      emitDeliveredReceipts: false,
      stateProvider: mockStateProvider,
      orchestratorId,
    };

    const results = await drainMailboxPass(opts, metrics);
    expect(results.length).toBe(1);
    expect(results[0]?.status).toBe("answered");
    expect(metrics.totalQueriesAnswered).toBe(1);
    expect(metrics.totalEscalated).toBe(0); // Query was NOT escalated!
  });

  test("drainMailboxPass executes custom onMessage handler", async () => {
    dispatchPeerMessage({
      senderId: peerId,
      senderRole: "liaison",
      recipientRoleOrId: liaisonId,
      messageType: "HANDOFF_RECEIPT",
      payload: { custom: "custom-data" },
      correlationId: "c-custom",
      baseDir,
    });

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

    let customHandled = false;
    const opts: ContinuousDrainOptions = {
      agentId: liaisonId,
      baseDir,
      emitDeliveredReceipts: false,
      onMessage: async (env) => {
        customHandled = true;
        return {
          messageId: env.id,
          correlationId: env.correlation_id,
          status: "processed",
        };
      },
    };

    const results = await drainMailboxPass(opts, metrics);
    expect(results.length).toBe(1);
    expect(customHandled).toBe(true);
    expect(results[0]?.status).toBe("processed");
  });

  test("startContinuousDrain manages background lifecycle and triggerDrain", async () => {
    const handle = startContinuousDrain({
      agentId: liaisonId,
      baseDir,
      idleWaitMs: 20,
      emitDeliveredReceipts: false,
    });

    expect(handle.isRunning).toBe(true);

    // Send a message
    dispatchPeerMessage({
      senderId: peerId,
      senderRole: "liaison",
      recipientRoleOrId: liaisonId,
      messageType: "PULSE_HEARTBEAT",
      payload: { beat: 1 },
      correlationId: "c-beat",
      baseDir,
    });

    // Explicitly trigger drain
    const triggerResults = await handle.triggerDrain();
    expect(triggerResults.length).toBe(1);

    const m = handle.getMetrics();
    expect(m.totalDrained).toBe(1);
    expect(m.cyclesCompleted).toBeGreaterThanOrEqual(1);

    await handle.stop();
    expect(handle.isRunning).toBe(false);
  });

  test("startContinuousDrain rejects invalid arguments", () => {
    expect(() => startContinuousDrain(null as unknown as ContinuousDrainOptions)).toThrow(
      HarnessError,
    );

    expect(() => startContinuousDrain({ agentId: "" })).toThrow(HarnessError);
  });
});
