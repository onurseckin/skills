import { describe, expect, test } from "bun:test";
import {
  clearInMemoryMailboxStore,
  setInMemoryStreamMode,
} from "../../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import type { MailboxEnvelope } from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  answerPeerStateQuery,
  dispatchPeerStateResponse,
  isPeerStateQuery,
  parsePeerQuery,
  type LiaisonStateProvider,
  type PeerQueryRequest,
} from "../../../olt/scripts/src/liaison/agent/index.ts";

describe("Peer State Query Engine (Non-Blocking / Zero Orchestrator Wakeup)", () => {
  const mockStateProvider: LiaisonStateProvider = {
    getLiveness: () => ({ status: "alive", uptimeSeconds: 3600, nextBeatIntervalMs: 5000 }),
    getRunState: (runId?: string) =>
      runId === "run-123" || !runId
        ? { runId: "run-123", status: "running", activeLanes: 3, distinctImplementers: 3 }
        : null,
    getLaneStatus: (laneId: string) =>
      laneId === "task-1"
        ? {
            laneId: "task-1",
            status: "leased",
            holder: "implementer_task-1",
            writeScope: ["src/a"],
          }
        : null,
    getRoster: () => [
      { id: "liaison_claude", role: "liaison", tier: 0 },
      { id: "orchestrator_main", role: "orchestrator", tier: 1 },
    ],
    getObligationStatus: (obligationId: string) =>
      obligationId === "ob-1"
        ? { obligationId: "ob-1", status: "bound", boundLane: "task-1" }
        : null,
    getMetrics: () => ({ gatePassedCount: 42, ratchetDirection: "improving" }),
  };

  test("isPeerStateQuery recognizes query envelopes", () => {
    const validQueryEnv: MailboxEnvelope = {
      id: "env-1",
      sequence: 1,
      sender_id: "liaison_antigravity",
      sender_role: "liaison",
      recipient_id: "liaison_claude",
      message_type: "PULSE_HEARTBEAT",
      timestamp: "2026-09-06T00:00:00Z",
      payload: { queryType: "LIVENESS" },
      correlation_id: "corr-1",
      hmac_signature: "sig",
    };
    expect(isPeerStateQuery(validQueryEnv)).toBe(true);

    const lowercaseQueryEnv: MailboxEnvelope = {
      ...validQueryEnv,
      payload: { query_type: "RUN_STATE" },
    };
    expect(isPeerStateQuery(lowercaseQueryEnv)).toBe(true);

    const nonQueryEnv: MailboxEnvelope = {
      ...validQueryEnv,
      payload: { someOtherData: 123 },
    };
    expect(isPeerStateQuery(nonQueryEnv)).toBe(false);
  });

  test("parsePeerQuery extracts structured request", () => {
    const env: MailboxEnvelope = {
      id: "env-2",
      sequence: 2,
      sender_id: "liaison_peer",
      sender_role: "liaison",
      recipient_id: "liaison_local",
      message_type: "HANDOFF_RECEIPT",
      timestamp: "2026-09-06T00:01:00Z",
      payload: { queryType: "LANE_STATUS", targetId: "task-1", queryId: "q-special" },
      correlation_id: "corr-2",
      hmac_signature: "sig",
    };

    const parsed = parsePeerQuery(env);
    expect(parsed.queryId).toBe("q-special");
    expect(parsed.queryType).toBe("LANE_STATUS");
    expect(parsed.targetId).toBe("task-1");
    expect(parsed.senderId).toBe("liaison_peer");

    const invalidEnv: MailboxEnvelope = { ...env, payload: {} };
    expect(() => parsePeerQuery(invalidEnv)).toThrow(HarnessError);
  });

  test("answerPeerStateQuery answers LIVENESS without waking orchestrator", () => {
    const query: PeerQueryRequest = {
      queryId: "q-live",
      senderId: "liaison_peer",
      queryType: "LIVENESS",
      timestamp: "2026-09-06T00:02:00Z",
    };

    const resp = answerPeerStateQuery(query, mockStateProvider, "liaison_claude");
    expect(resp.queryId).toBe("q-live");
    expect(resp.responderId).toBe("liaison_claude");
    expect(resp.success).toBe(true);
    expect(resp.payload.status).toBe("alive");
  });

  test("answerPeerStateQuery answers RUN_STATE and handles missing runs", () => {
    const validQuery: PeerQueryRequest = {
      queryId: "q-run-1",
      senderId: "liaison_peer",
      queryType: "RUN_STATE",
      targetId: "run-123",
      timestamp: "2026-09-06T00:03:00Z",
    };
    const validResp = answerPeerStateQuery(validQuery, mockStateProvider, "liaison_claude");
    expect(validResp.success).toBe(true);
    expect(validResp.payload.runId).toBe("run-123");

    const missingQuery: PeerQueryRequest = {
      ...validQuery,
      targetId: "run-missing",
    };
    const missingResp = answerPeerStateQuery(missingQuery, mockStateProvider, "liaison_claude");
    expect(missingResp.success).toBe(false);
    expect(missingResp.error).toContain("run-missing");
  });

  test("answerPeerStateQuery answers LANE_STATUS, ROSTER, OBLIGATIONS, METRICS", () => {
    // LANE_STATUS
    const laneResp = answerPeerStateQuery(
      {
        queryId: "q-lane",
        senderId: "p",
        queryType: "LANE_STATUS",
        targetId: "task-1",
        timestamp: "t",
      },
      mockStateProvider,
      "liaison_claude",
    );
    expect(laneResp.success).toBe(true);
    expect(laneResp.payload.holder).toBe("implementer_task-1");

    // Missing lane target
    const laneMissingTarget = answerPeerStateQuery(
      { queryId: "q-lane-no-target", senderId: "p", queryType: "LANE_STATUS", timestamp: "t" },
      mockStateProvider,
      "liaison_claude",
    );
    expect(laneMissingTarget.success).toBe(false);

    // ROSTER
    const rosterResp = answerPeerStateQuery(
      { queryId: "q-roster", senderId: "p", queryType: "ROSTER", timestamp: "t" },
      mockStateProvider,
      "liaison_claude",
    );
    expect(rosterResp.success).toBe(true);
    expect(Array.isArray(rosterResp.payload.roster)).toBe(true);

    // OBLIGATIONS
    const obResp = answerPeerStateQuery(
      {
        queryId: "q-ob",
        senderId: "p",
        queryType: "OBLIGATIONS",
        targetId: "ob-1",
        timestamp: "t",
      },
      mockStateProvider,
      "liaison_claude",
    );
    expect(obResp.success).toBe(true);
    expect(obResp.payload.status).toBe("bound");

    // METRICS
    const metricsResp = answerPeerStateQuery(
      { queryId: "q-met", senderId: "p", queryType: "METRICS", timestamp: "t" },
      mockStateProvider,
      "liaison_claude",
    );
    expect(metricsResp.success).toBe(true);
    expect(metricsResp.payload.gatePassedCount).toBe(42);
  });

  test("dispatchPeerStateResponse delivers signed response to peer mailbox", () => {
    setInMemoryStreamMode(true);
    clearInMemoryMailboxStore();

    const queryResp = {
      queryId: "q-delivery",
      responderId: "liaison_claude" as const,
      success: true,
      timestamp: "2026-09-06T00:04:00Z",
      payload: { ping: "pong" },
    };

    const dispatched = dispatchPeerStateResponse(
      queryResp,
      "liaison_claude",
      "liaison_antigravity",
      { baseDir: "virtual:test-cluster" },
    );

    expect(dispatched.id).toBeDefined();
    expect(dispatched.sender_id).toBe("liaison_claude");
    expect(dispatched.recipient_id).toBe("liaison_antigravity");
    expect(dispatched.payload.queryId).toBe("q-delivery");

    setInMemoryStreamMode(false);
  });
});
