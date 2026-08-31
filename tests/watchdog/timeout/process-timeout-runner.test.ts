import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DIAGNOSTIC_TAIL_BYTES,
  DEFAULT_GRACE_PERIOD_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALL_PROGRESS_THRESHOLD_MS,
  DEFAULT_TEST_IDLE_TIMEOUT_MS,
  DEFAULT_TEST_WALL_TIMEOUT_MS,
  ERROR_CLASS_IDLE_TIMEOUT,
  ERROR_CLASS_PROCESS_HANG,
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_WALL_TIMEOUT,
  ERROR_CLASS_ZOMBIE_PROCESS,
  EXIT_STATUS_EXIT_FAILURE,
  EXIT_STATUS_EXIT_SUCCESS,
  EXIT_STATUS_SIGKILL_MANUAL,
  EXIT_STATUS_SIGKILL_TIMEOUT,
  EXIT_STATUS_SIGTERM_TIMEOUT,
  createProcessTimeoutWatchdog,
  ProcessTimeoutWatchdog,
} from "../../../olt/scripts/src/watchdog/process-timeout/index.ts";

describe("ProcessTimeoutWatchdog Constants & Lifecycle Runner", () => {
  it("exports standard constants with expected values", () => {
    expect(DEFAULT_TEST_WALL_TIMEOUT_MS).toBe(60_000);
    expect(DEFAULT_TEST_IDLE_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(1_000);
    expect(DEFAULT_STALL_PROGRESS_THRESHOLD_MS).toBe(60_000);
    expect(DEFAULT_GRACE_PERIOD_MS).toBe(1_000);
    expect(DEFAULT_DIAGNOSTIC_TAIL_BYTES).toBe(64 * 1024);
    expect(EXIT_STATUS_SIGKILL_TIMEOUT).toBe("SIGKILL_TIMEOUT");
    expect(EXIT_STATUS_SIGTERM_TIMEOUT).toBe("SIGTERM_TIMEOUT");
    expect(EXIT_STATUS_SIGKILL_MANUAL).toBe("SIGKILL_MANUAL");
    expect(EXIT_STATUS_EXIT_FAILURE).toBe("EXIT_FAILURE");
    expect(EXIT_STATUS_EXIT_SUCCESS).toBe("EXIT_SUCCESS");
    expect(ERROR_CLASS_STALL_TIMEOUT).toBe("STALL_TIMEOUT");
    expect(ERROR_CLASS_WALL_TIMEOUT).toBe("WALL_TIMEOUT");
    expect(ERROR_CLASS_IDLE_TIMEOUT).toBe("IDLE_TIMEOUT");
    expect(ERROR_CLASS_PROCESS_HANG).toBe("PROCESS_HANG");
    expect(ERROR_CLASS_ZOMBIE_PROCESS).toBe("ZOMBIE_PROCESS");
  });

  it("initializes with default and custom configurable limits", () => {
    const defaultWatchdog = createProcessTimeoutWatchdog({ pid: 12345 });
    expect(defaultWatchdog.wallTimeoutMs).toBe(60_000);
    expect(defaultWatchdog.idleTimeoutMs).toBe(30_000);
    expect(defaultWatchdog.heartbeatIntervalMs).toBe(1_000);
    expect(defaultWatchdog.stallProgressThresholdMs).toBe(60_000);
    expect(defaultWatchdog.graceMs).toBe(1_000);
    expect(defaultWatchdog.maxTailBytes).toBe(64 * 1024);
    expect(defaultWatchdog.supervisorTier).toBe("coordinator");
    expect(defaultWatchdog.childRole).toBe("task_implementer");

    const customWatchdog = new ProcessTimeoutWatchdog({
      pid: 54321,
      ppid: 11111,
      taskId: "task-abc",
      gateId: "gate-xyz",
      agentId: "agent-007",
      supervisorTier: "orchestrator",
      childRole: "completeness_critic",
      wallTimeoutMs: 15_000,
      idleTimeoutMs: 5_000,
      stallProgressThresholdMs: 10_000,
      heartbeatIntervalMs: 500,
      graceMs: 250,
      maxTailBytes: 1024,
    });
    expect(customWatchdog.pid).toBe(54321);
    expect(customWatchdog.ppid).toBe(11111);
    expect(customWatchdog.taskId).toBe("task-abc");
    expect(customWatchdog.gateId).toBe("gate-xyz");
    expect(customWatchdog.agentId).toBe("agent-007");
    expect(customWatchdog.supervisorTier).toBe("orchestrator");
    expect(customWatchdog.childRole).toBe("completeness_critic");
    expect(customWatchdog.wallTimeoutMs).toBe(15_000);
    expect(customWatchdog.idleTimeoutMs).toBe(5_000);
    expect(customWatchdog.stallProgressThresholdMs).toBe(10_000);
    expect(customWatchdog.heartbeatIntervalMs).toBe(500);
    expect(customWatchdog.graceMs).toBe(250);
    expect(customWatchdog.maxTailBytes).toBe(1024);
  });

  it("synthesizes structured failure payloads with accurate metadata and diagnostics", () => {
    let now = 1700000000000;
    const watchdog = new ProcessTimeoutWatchdog({
      pid: 9999,
      taskId: "task-fail",
      agentId: "agent-fail",
      childRole: "task_implementer",
      supervisorTier: "coordinator",
      now: () => now,
      startedAt: now,
    });

    watchdog.recordActivity("stdout", "Task started\n");
    now += 5000;
    watchdog.recordActivity("stderr", "Warning: slow progress\n");
    now += 65000;

    const payload = watchdog.synthesizeFailurePayload({
      exitStatus: "SIGKILL_TIMEOUT",
      errorClassification: "STALL_TIMEOUT",
      reason: "No progress recorded for 65s",
      now,
    });

    expect(payload.schema).toBe("harness.structured_failure_payload");
    expect(payload.version).toBe(1);
    expect(payload.exitStatus).toBe("SIGKILL_TIMEOUT");
    expect(payload.errorClassification).toBe("STALL_TIMEOUT");
    expect(payload.childPid).toBe(9999);
    expect(payload.taskId).toBe("task-fail");
    expect(payload.agentId).toBe("agent-fail");
    expect(payload.diagnostics.stdoutTail).toContain("Task started");
    expect(payload.diagnostics.stderrTail).toContain("Warning: slow progress");
    expect(payload.remediationGuidance.action).toBe("autonomous_repair_routing");
  });

  it("checks liveness and tracks progress, heartbeats and idle decay accurately", () => {
    let now = 1700000000000;
    const watchdog = new ProcessTimeoutWatchdog({
      pid: 1234,
      wallTimeoutMs: 10_000,
      idleTimeoutMs: 5_000,
      stallProgressThresholdMs: 3_000,
      now: () => now,
      startedAt: now,
    });

    expect(watchdog.checkLiveness(now).alive).toBe(true);

    // Record heartbeat
    watchdog.emitHeartbeat({ note: "step-1" });
    expect(watchdog.getDiagnostics(now).lastHeartbeatAt).toBe(new Date(now).toISOString());

    // Record progress
    watchdog.recordProgress("Parsing AST");
    expect(watchdog.getDiagnostics(now).lastProgressAt).toBe(new Date(now).toISOString());

    // Idle timeout check
    now += 6000;
    const livenessIdle = watchdog.checkLiveness(now);
    expect(livenessIdle.alive).toBe(false);
    expect(livenessIdle.timeoutKind).toBe("idle");
    expect(livenessIdle.errorClassification).toBe("IDLE_TIMEOUT");
  });
});
