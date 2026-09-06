import { describe, expect, test } from "bun:test";
import {
  clearInMemoryMailboxStore,
  setInMemoryStreamMode,
} from "../../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import type { MailboxEnvelope } from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  evaluateEscalation,
  routeEscalation,
  type PlanOrState,
} from "../../../olt/scripts/src/liaison/agent/index.ts";

describe("Liaison Escalation Router (Strict Orchestrator Protection)", () => {
  const samplePlan: PlanOrState = {
    runId: "run-esc-test",
    lanes: [
      {
        laneId: "task-1",
        runId: "run-esc-test",
        writeScope: ["olt/scripts/src/liaison/agent"],
      },
    ],
  };

  test("heartbeats and state queries are handled locally and NOT escalated", () => {
    const heartbeatEnv: MailboxEnvelope = {
      id: "env-hb",
      sequence: 1,
      sender_id: "liaison_antigravity",
      sender_role: "liaison",
      recipient_id: "liaison_claude",
      message_type: "PULSE_HEARTBEAT",
      timestamp: "2026-09-06T00:00:00Z",
      payload: { status: "alive" },
      correlation_id: "corr-hb",
      hmac_signature: "sig",
    };

    const evalHb = evaluateEscalation(heartbeatEnv, samplePlan);
    expect(evalHb.shouldEscalate).toBe(false);
    expect(evalHb.requiresPlanning).toBe(false);
    expect(evalHb.requiresExecution).toBe(false);

    const queryEnv: MailboxEnvelope = {
      ...heartbeatEnv,
      payload: { queryType: "LIVENESS" },
    };
    const evalQuery = evaluateEscalation(queryEnv, samplePlan);
    expect(evalQuery.shouldEscalate).toBe(false);
  });

  test("delivered and bound receipts are handled locally and NOT escalated", () => {
    const receiptEnv: MailboxEnvelope = {
      id: "env-rcpt",
      sequence: 2,
      sender_id: "liaison_peer",
      sender_role: "liaison",
      recipient_id: "liaison_local",
      message_type: "HANDOFF_RECEIPT",
      timestamp: "2026-09-06T00:01:00Z",
      payload: { type: "RECEIPT_BOUND", directive_id: "dir-1" },
      correlation_id: "corr-rcpt",
      hmac_signature: "sig",
    };

    const evalReceipt = evaluateEscalation(receiptEnv, samplePlan);
    expect(evalReceipt.shouldEscalate).toBe(false);
  });

  test("directive with bound paths is NOT escalated", () => {
    const boundDirectiveEnv: MailboxEnvelope = {
      id: "env-bound-dir",
      sequence: 3,
      sender_id: "liaison_peer",
      sender_role: "liaison",
      recipient_id: "liaison_local",
      message_type: "DISPATCH_TASK",
      timestamp: "2026-09-06T00:02:00Z",
      payload: {
        directiveId: "dir-bound",
        targetPaths: ["olt/scripts/src/liaison/agent/types.ts"],
      },
      correlation_id: "corr-dir",
      hmac_signature: "sig",
    };

    const evalBound = evaluateEscalation(boundDirectiveEnv, samplePlan);
    expect(evalBound.shouldEscalate).toBe(false);
  });

  test("directive with unbound paths ESCALATES to orchestrator for planning", () => {
    const unboundDirectiveEnv: MailboxEnvelope = {
      id: "env-unbound-dir",
      sequence: 4,
      sender_id: "liaison_peer",
      sender_role: "liaison",
      recipient_id: "liaison_local",
      message_type: "DISPATCH_TASK",
      timestamp: "2026-09-06T00:03:00Z",
      payload: {
        directiveId: "dir-unbound",
        targetPaths: ["unallocated/foreign/path.ts"],
      },
      correlation_id: "corr-unbound",
      hmac_signature: "sig",
    };

    const evalUnbound = evaluateEscalation(unboundDirectiveEnv, samplePlan);
    expect(evalUnbound.shouldEscalate).toBe(true);
    expect(evalUnbound.requiresPlanning).toBe(true);
    expect(evalUnbound.requiresExecution).toBe(false);
    expect(evalUnbound.reason).toContain("unallocated/foreign/path.ts");
  });

  test("defect escalations and alerts escalate immediately", () => {
    const defectEnv: MailboxEnvelope = {
      id: "env-defect",
      sequence: 5,
      sender_id: "liaison_peer",
      sender_role: "liaison",
      recipient_id: "liaison_local",
      message_type: "DEFECT_ESCALATION",
      timestamp: "2026-09-06T00:04:00Z",
      payload: { issue: "Verification hash mismatch" },
      correlation_id: "corr-defect",
      hmac_signature: "sig",
    };

    const evalDefect = evaluateEscalation(defectEnv, samplePlan);
    expect(evalDefect.shouldEscalate).toBe(true);
    expect(evalDefect.urgency).toBe("HIGH");

    const alertEnv: MailboxEnvelope = { ...defectEnv, message_type: "SYSTEM_ALERT" };
    expect(evaluateEscalation(alertEnv, samplePlan).shouldEscalate).toBe(true);
  });

  test("failed validation verdicts and cognitive pushbacks escalate", () => {
    const pushbackEnv: MailboxEnvelope = {
      id: "env-pb",
      sequence: 6,
      sender_id: "agent_validator",
      sender_role: "validator",
      recipient_id: "liaison_local",
      message_type: "COGNITIVE_PUSHBACK",
      timestamp: "2026-09-06T00:05:00Z",
      payload: { deadlock: true },
      correlation_id: "corr-pb",
      hmac_signature: "sig",
    };
    expect(evaluateEscalation(pushbackEnv).shouldEscalate).toBe(true);

    const failedVerdictEnv: MailboxEnvelope = {
      id: "env-vv",
      sequence: 7,
      sender_id: "agent_validator",
      sender_role: "validator",
      recipient_id: "liaison_local",
      message_type: "VALIDATION_VERDICT",
      timestamp: "2026-09-06T00:06:00Z",
      payload: { passed: false, verdict: "REJECTED" },
      correlation_id: "corr-vv",
      hmac_signature: "sig",
    };
    expect(evaluateEscalation(failedVerdictEnv).shouldEscalate).toBe(true);
  });

  test("routeEscalation routes to orchestrator mailbox only when required", () => {
    setInMemoryStreamMode(true);
    clearInMemoryMailboxStore();

    const orchestratorId = "orchestrator_phase-fundamentals";
    const baseDir = "virtual:esc-cluster";

    // 1. Non-escalating message
    const heartbeatEnv: MailboxEnvelope = {
      id: "env-hb2",
      sequence: 10,
      sender_id: "liaison_peer",
      sender_role: "liaison",
      recipient_id: "liaison_claude",
      message_type: "PULSE_HEARTBEAT",
      timestamp: "2026-09-06T00:07:00Z",
      payload: { status: "alive" },
      correlation_id: "corr-hb2",
      hmac_signature: "sig",
    };

    const routeLocal = routeEscalation(heartbeatEnv, "liaison_claude", {
      orchestratorId,
      baseDir,
    });
    expect(routeLocal.escalated).toBe(false);
    expect(routeLocal.dispatchedEnvelopeId).toBeUndefined();

    // 2. Escalating message
    const alertEnv: MailboxEnvelope = {
      id: "env-alert",
      sequence: 11,
      sender_id: "liaison_peer",
      sender_role: "liaison",
      recipient_id: "liaison_claude",
      message_type: "SYSTEM_ALERT",
      timestamp: "2026-09-06T00:08:00Z",
      payload: { alert: "Peer heartbeat timeout" },
      correlation_id: "corr-alert",
      hmac_signature: "sig",
    };

    const routeAlert = routeEscalation(alertEnv, "liaison_claude", {
      orchestratorId,
      baseDir,
    });
    expect(routeAlert.escalated).toBe(true);
    expect(routeAlert.dispatchedEnvelopeId).toBeDefined();

    setInMemoryStreamMode(false);
  });

  test("routeEscalation validates inputs with HarnessError", () => {
    expect(() =>
      routeEscalation(null as unknown as MailboxEnvelope, "liaison_claude", {
        orchestratorId: "orch",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      routeEscalation({} as MailboxEnvelope, "liaison_claude", {
        orchestratorId: "",
      }),
    ).toThrow(HarnessError);
  });
});
