import { describe, expect, test } from "bun:test";
import {
  ERROR_CLASS_STALL_TIMEOUT,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  ProcessTimeoutWatchdog,
  buildRemediationGuidance,
} from "../../../olt/scripts/src/engine/runner/process/process-timeout-watchdog.ts";

describe("ProcessTimeoutWatchdog - SIGKILL Enforcement & Signal Escalation", () => {
  test("sends SIGTERM then escalates to SIGKILL after grace period", async () => {
    const signalsReceived: NodeJS.Signals[] = [];
    const delays: number[] = [];

    const mockKill = (_pid: number, sig: NodeJS.Signals): boolean => {
      signalsReceived.push(sig);
      return true;
    };

    const mockWait = async (ms: number): Promise<unknown> => {
      delays.push(ms);
      return Promise.resolve();
    };

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 7777,
      graceMs: 500,
      killProcessTree: mockKill,
      wait: mockWait,
    });

    const sent = await watchdog.enforceSigkill();
    expect(sent).toEqual(["SIGTERM", "SIGKILL"]);
    expect(signalsReceived).toEqual(["SIGTERM", "SIGKILL"]);
    expect(delays).toEqual([500]);
  });

  test("skips SIGTERM and directly SIGKILLs if graceMs is 0", async () => {
    const signalsReceived: NodeJS.Signals[] = [];

    const mockKill = (_pid: number, sig: NodeJS.Signals): boolean => {
      signalsReceived.push(sig);
      return true;
    };

    const watchdog = new ProcessTimeoutWatchdog({
      pid: 8888,
      graceMs: 0,
      killProcessTree: mockKill,
    });

    const sent = await watchdog.enforceSigkill({ graceMs: 0 });
    expect(sent).toEqual(["SIGKILL"]);
    expect(signalsReceived).toEqual(["SIGKILL"]);
  });

  test("gracefully handles invalid pid <= 1 without sending dangerous signals", async () => {
    const signalsReceived: NodeJS.Signals[] = [];
    const watchdog = new ProcessTimeoutWatchdog({
      pid: 1,
      killProcessTree: (_pid, sig) => {
        signalsReceived.push(sig);
        return true;
      },
    });

    const sent = await watchdog.enforceSigkill();
    expect(sent).toEqual([]);
    expect(signalsReceived).toEqual([]);
  });
});

describe("ProcessTimeoutWatchdog - Structured Failure Payload & Remediation Guidance", () => {
  test("synthesizes structured failure payload with diagnostics and defect reference", () => {
    let now = 1_000_000;
    const watchdog = new ProcessTimeoutWatchdog({
      pid: 5432,
      ppid: 5000,
      taskId: "task-compile-run",
      gateId: "gate-unit-tests",
      agentId: "critic-agent-1",
      supervisorTier: "coordinator",
      childRole: "completeness_critic",
      now: () => now,
    });

    watchdog.recordActivity("stdout", "running test suite...\n");
    watchdog.recordActivity("stderr", "WARNING: possible infinite loop\n");

    now += 65_000;

    const payload = watchdog.synthesizeFailurePayload({
      exitStatus: EXIT_STATUS_SIGKILL_TIMEOUT,
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
      reason: "Critic test run hung on zombie process (task-107)",
      defectReference: "defect-20260822-24",
    });

    expect(payload.schema).toBe("harness.structured_failure_payload");
    expect(payload.version).toBe(1);
    expect(payload.exitStatus).toBe(EXIT_STATUS_SIGKILL_TIMEOUT);
    expect(payload.errorClassification).toBe(ERROR_CLASS_STALL_TIMEOUT);
    expect(payload.reason).toBe("Critic test run hung on zombie process (task-107)");
    expect(payload.taskId).toBe("task-compile-run");
    expect(payload.gateId).toBe("gate-unit-tests");
    expect(payload.agentId).toBe("critic-agent-1");
    expect(payload.supervisorTier).toBe("coordinator");
    expect(payload.childRole).toBe("completeness_critic");
    expect(payload.childPid).toBe(5432);

    expect(payload.diagnostics.stdoutTail).toContain("running test suite...");
    expect(payload.diagnostics.stderrTail).toContain("WARNING: possible infinite loop");
    expect(payload.diagnostics.durationMs).toBe(65_000);

    expect(payload.remediationGuidance.action).toBe("autonomous_repair_routing");
    expect(payload.remediationGuidance.defectReference).toBe("defect-20260822-24");
    expect(payload.remediationGuidance.supervisorTarget).toBe("coordinator");
    expect(payload.remediationGuidance.prescribedSteps.length).toBeGreaterThan(2);
    expect(payload.remediationGuidance.fallbackDirective).toContain("single-file scoped unit test");
  });

  test("generates appropriate remediation guidance for implementer hang (defect-20260822-28)", () => {
    const guidance = buildRemediationGuidance({
      role: "task_implementer",
      supervisorTier: "coordinator",
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
      defectReference: "defect-20260822-28",
    });

    expect(guidance.action).toBe("autonomous_repair_routing");
    expect(guidance.defectReference).toBe("defect-20260822-28");
    expect(guidance.supervisorTarget).toBe("coordinator");
    expect(guidance.summary).toContain("Stalled task implementer execution detected");
  });

  test("generates appropriate remediation guidance for coordinator stall", () => {
    const guidance = buildRemediationGuidance({
      role: "coordinator",
      supervisorTier: "orchestrator",
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
    });

    expect(guidance.action).toBe("escalate_to_supervisor");
    expect(guidance.supervisorTarget).toBe("orchestrator");
    expect(guidance.summary).toContain("Stalled coordinator execution detected");
  });

  test("generates appropriate remediation guidance for orchestrator stall", () => {
    const guidance = buildRemediationGuidance({
      role: "orchestrator",
      supervisorTier: "mind",
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
    });

    expect(guidance.action).toBe("escalate_to_supervisor");
    expect(guidance.supervisorTarget).toBe("mind");
    expect(guidance.summary).toContain("Stalled orchestrator execution detected");
  });
});
